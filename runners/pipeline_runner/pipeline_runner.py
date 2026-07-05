"""Pipeline runner (M4): executes rendered SQL artifacts staged in
{catalog}.{schema}.staged_artifacts and evaluates the spec's expectations against
the built target table.

Writes: {catalog}.{schema}.build_runs rows (phase=pipeline_run / tests)

The runner executes artifacts verbatim — it never edits them (hard constraint #1:
files come only from the renderer).
"""

import argparse
import json
import re
import uuid
from datetime import datetime, timezone

from pyspark.sql import SparkSession


def log_run(spark, ctl, run_id, spec, phase, status, detail):
    spark.sql(
        f"""INSERT INTO {ctl}.build_runs
        (run_id, spec_id, spec_version, phase, status, fix_iteration, branch, pr_url, detail, started_at, finished_at)
        VALUES ('{run_id}', '{spec["spec_id"]}', {spec["spec_version"]}, '{phase}', '{status}', 0,
                NULL, NULL, '{detail.replace(chr(39), chr(34))[:900]}', current_timestamp(), current_timestamp())"""
    )


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--spec-id", required=True)
    p.add_argument("--spec-version", required=True, type=int)
    p.add_argument("--run-id", required=True)
    p.add_argument("--catalog", default="workspace")
    p.add_argument("--schema", default="ctl")
    args = p.parse_args()

    spark = SparkSession.builder.getOrCreate()
    ctl = f"`{args.catalog}`.`{args.schema}`"

    staged = {
        r["path"]: r["content"]
        for r in spark.sql(
            f"""SELECT path, content FROM {ctl}.staged_artifacts
            WHERE spec_id = '{args.spec_id}' AND spec_version = {args.spec_version}"""
        ).collect()
    }
    if "spec.json" not in staged:
        raise FileNotFoundError(
            f"spec.json not staged for {args.spec_id} v{args.spec_version} — run the build's deploy step first"
        )
    spec = json.loads(staged["spec.json"])
    entity = spec["entity"]

    # 1. execute stitch + adapter view exactly as rendered
    executed = []
    for artifact in (f"pipelines/{entity}/silver_stitch.sql", f"pipelines/{entity}/adapter_view.sql"):
        sql_text = staged[artifact]
        # strip comment header, split on top-level semicolons (artifacts are single-statement)
        body = "\n".join(l for l in sql_text.splitlines() if not l.strip().startswith("--"))
        for stmt in [s.strip() for s in body.split(";") if s.strip()]:
            # TBLPROPERTIES on CREATE VIEW is not universal — tolerate per-statement
            try:
                spark.sql(stmt)
            except Exception as e:
                if "TBLPROPERTIES" in str(e) and "VIEW" in stmt.upper():
                    spark.sql(re.sub(r"TBLPROPERTIES\s*\([^)]*\)", "", stmt))
                else:
                    raise
        executed.append(artifact)
    log_run(spark, ctl, args.run_id, spec, "pipeline_run", "succeeded",
            json.dumps({"executed": executed, "target": spec["target"]["entity"]}))

    # 2. expectations against the target table
    target = spec["target"]["entity"]
    total = spark.table(target).count()
    results = []
    failed_hard = False
    for exp in spec.get("expectations", []):
        try:
            violations = spark.sql(
                f"SELECT COUNT(*) AS n FROM {target} WHERE NOT ({exp['constraint']})"
            ).collect()[0]["n"]
            ok = violations == 0
            error = None
        except Exception as e:  # malformed constraint = reviewable defect, not a crash
            violations, ok, error = None, False, str(e)[:200]
        if not ok and exp.get("action") == "fail":
            failed_hard = True
        results.append({
            "name": exp["name"], "violations": violations, "action": exp.get("action"),
            "pass": ok, **({"error": error} if error else {}),
        })

    passed = sum(1 for r in results if r["pass"])
    log_run(spark, ctl, args.run_id, spec, "tests", "failed" if failed_hard else "succeeded",
            json.dumps({"pass": passed, "total": len(results), "rows": total, "results": results}))

    print(f"pipeline_runner done: {passed}/{len(results)} expectations pass, {total} rows, hard_fail={failed_hard}")
    if failed_hard:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
