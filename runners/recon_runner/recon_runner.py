"""Recon runner (M4): count + key + attribute compare between source and target,
driven entirely by the spec's crosswalk and per-column compare config.

Writes: {catalog}.{schema}.recon_runs / recon_entity_result / recon_record_diff
"""

import argparse
import json

from pyspark.sql import SparkSession


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--spec-id", required=True)
    p.add_argument("--spec-version", required=True, type=int)
    p.add_argument("--run-id", required=True)
    p.add_argument("--recon-id", required=True)
    p.add_argument("--catalog", default="workspace")
    p.add_argument("--schema", default="ctl")
    args = p.parse_args()

    spark = SparkSession.builder.getOrCreate()
    ctl = f"`{args.catalog}`.`{args.schema}`"
    rows = spark.sql(
        f"""SELECT content FROM {ctl}.staged_artifacts
        WHERE spec_id = '{args.spec_id}' AND spec_version = {args.spec_version} AND path = 'spec.json'"""
    ).collect()
    if not rows:
        raise FileNotFoundError(f"spec.json not staged for {args.spec_id} v{args.spec_version}")
    spec = json.loads(rows[0]["content"])

    src_tbl = spec["source"]["entity"]
    tgt_tbl = spec["target"]["entity"]
    xw_tbl = spec["crosswalk"]["table"]
    key = spec["crosswalk"]["keys"][0]
    src_key, tgt_key = key["source"], key["target"]
    entity = spec["entity"]

    spark.sql(
        f"""INSERT INTO {ctl}.recon_runs (recon_id, run_id, spec_id, spec_version, status, started_at, finished_at)
        VALUES ('{args.recon_id}', '{args.run_id}', '{args.spec_id}', {args.spec_version}, 'running',
                current_timestamp(), NULL)"""
    )

    source_count = spark.table(src_tbl).count()
    target_count = spark.table(tgt_tbl).count()

    # key match: source rows whose key survives crosswalk into the target
    key_matches = spark.sql(
        f"""SELECT COUNT(*) AS n
        FROM {src_tbl} src
        INNER JOIN {xw_tbl} xw ON src.`{src_key}` = xw.`{src_key}`
        INNER JOIN {tgt_tbl} tgt ON tgt.`{tgt_key}` = src.`{src_key}`"""
    ).collect()[0]["n"]
    key_match_rate = key_matches / source_count if source_count else 0.0

    # attribute compare: transformed source expression vs target column, honoring
    # per-column normalize/tolerance from the spec's compare config
    compare_cols = [c for c in spec["columns"] if c.get("compare", {}).get("enabled", True)]
    diff_exprs, col_names = [], []
    for c in compare_cols:
        src_expr = c["transform"] or f"src.`{c['name']}`"
        tgt_expr = f"tgt.`{c['target']}`"
        # only apply a normalize expression that actually references `value`
        # (LLMs sometimes emit a bare word like "lowercase" -> invalid SQL)
        norm = c.get("compare", {}).get("normalize")
        if norm and "value" in norm:
            src_expr = norm.replace("value", f"({src_expr})")
            tgt_expr = norm.replace("value", tgt_expr)
        tol = c.get("compare", {}).get("tolerance")
        if tol is not None:
            cond = f"ABS(COALESCE(CAST(({src_expr}) AS DOUBLE),0) - COALESCE(CAST({tgt_expr} AS DOUBLE),0)) > {tol}"
        else:
            cond = f"NOT (({src_expr}) <=> {tgt_expr})"
        diff_exprs.append(f"CAST({cond} AS INT) AS diff_{c['target']}")
        col_names.append(c["target"])

    joined = spark.sql(
        f"""SELECT src.`{src_key}` AS _key, {', '.join(diff_exprs)}
        FROM {src_tbl} src
        INNER JOIN {xw_tbl} xw ON src.`{src_key}` = xw.`{src_key}`
        INNER JOIN {tgt_tbl} tgt ON tgt.`{tgt_key}` = src.`{src_key}`"""
    )
    joined.createOrReplaceTempView("recon_joined")

    n_joined = spark.table("recon_joined").count()
    sums = spark.sql(
        "SELECT " + ", ".join(f"SUM(diff_{c}) AS d_{c}" for c in col_names) + ", "
        + "SUM(CAST((" + " + ".join(f"diff_{c}" for c in col_names) + ") > 0 AS INT)) AS rows_with_diff "
        + "FROM recon_joined"
    ).collect()[0]
    total_cells = n_joined * len(col_names)
    total_diffs = sum(sums[f"d_{c}"] or 0 for c in col_names)
    rows_with_diff = sums["rows_with_diff"] or 0
    attr_match_rate = 1 - (total_diffs / total_cells) if total_cells else 0.0
    row_match_rate = 1 - (rows_with_diff / n_joined) if n_joined else 0.0

    spark.sql(
        f"""INSERT INTO {ctl}.recon_entity_result
        (recon_id, entity, source_count, target_count, key_match_rate, row_match_rate, attr_match_rate, created_at)
        VALUES ('{args.recon_id}', '{entity}', {source_count}, {target_count},
                {key_match_rate}, {row_match_rate}, {attr_match_rate}, current_timestamp())"""
    )

    # sample of concrete diffs for the drill-down table (bounded)
    for c in col_names:
        diffs = spark.sql(f"SELECT _key FROM recon_joined WHERE diff_{c} = 1 LIMIT 25").collect()
        for row in diffs:
            spark.sql(
                f"""INSERT INTO {ctl}.recon_record_diff
                (recon_id, entity, key_value, column_name, source_value, target_value, created_at)
                VALUES ('{args.recon_id}', '{entity}', '{row["_key"]}', '{c}', NULL, NULL, current_timestamp())"""
            )

    spark.sql(
        f"""UPDATE {ctl}.recon_runs SET status = 'succeeded', finished_at = current_timestamp()
        WHERE recon_id = '{args.recon_id}'"""
    )
    print(
        f"recon done: src={source_count} tgt={target_count} "
        f"key={key_match_rate:.4f} row={row_match_rate:.4f} attr={attr_match_rate:.4f}"
    )


if __name__ == "__main__":
    main()
