# Production is prepared but refused until it is approved. Mocked provider, no network.

mock_provider "aws" {
  override_during = plan
}

variables {
  account_id = "444455556666"
}

run "production_is_refused_by_default" {
  command = plan

  expect_failures = [terraform_data.production_guard]
}
