# Production secrets are refused until production is approved. Mocked provider, fictional values.

mock_provider "aws" {
  override_during = plan
}

variables {
  account_id         = "444455556666"
  database_url       = "fictional-database-connection-value"
  better_auth_secret = "fictional-secret-value-with-32-characters"
}

run "production_secrets_are_refused_by_default" {
  command = plan

  expect_failures = [terraform_data.production_guard]
}
