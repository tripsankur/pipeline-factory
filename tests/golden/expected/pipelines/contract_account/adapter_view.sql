-- generated_by: pipeline_factory
-- spec_id: spec-golden-001
-- spec_version: 1
-- DO NOT EDIT — rendered from the approved spec; changes belong in the spec.
-- Legacy-shaped adapter view: exposes workspace.silver.contract_account in the source shape
-- so downstream consumers keep working during cutover.

CREATE OR REPLACE VIEW workspace.silver.contract_account_legacy_adapter
TBLPROPERTIES (
  'generated_by' = 'pipeline_factory',
  'spec_id' = 'spec-golden-001',
  'spec_version' = '1'
)
AS
SELECT
  `sf_account_id` AS `account_id`,
  `status` AS `status_cd`,
  `balance` AS `balance_amt`
FROM workspace.silver.contract_account
