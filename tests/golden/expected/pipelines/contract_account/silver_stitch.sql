-- generated_by: pipeline_factory
-- spec_id: spec-golden-001
-- spec_version: 1
-- DO NOT EDIT — rendered from the approved spec; changes belong in the spec.
-- Silver stitch: workspace.bronze.aldm_contract_account -> workspace.silver.contract_account via crosswalk join.

CREATE OR REPLACE TABLE workspace.silver.contract_account
TBLPROPERTIES (
  'generated_by' = 'pipeline_factory',
  'spec_id' = 'spec-golden-001',
  'spec_version' = '1'
)
AS
SELECT
src.`account_id` AS `sf_account_id`,
CASE WHEN src.`status_cd` = 'A' THEN 'Active' ELSE 'Inactive' END AS `status`,
CAST(src.`balance_amt` AS DECIMAL(18,2)) AS `balance`
FROM workspace.bronze.aldm_contract_account AS src
INNER JOIN workspace.silver.crosswalk_account AS xw
ON src.`account_id` = xw.`sf_account_id`
