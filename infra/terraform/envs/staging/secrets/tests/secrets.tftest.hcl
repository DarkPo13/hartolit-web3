# Plans against a mocked AWS provider. The values below are fictional.

mock_provider "aws" {
  override_during = plan
}

variables {
  account_id         = "111122223333"
  database_url       = "fictional-database-connection-value"
  better_auth_secret = "fictional-secret-value-with-32-characters"
}

run "secrets_are_write_only" {
  command = plan

  assert {
    condition     = aws_ssm_parameter.database_url.type == "SecureString" && aws_ssm_parameter.better_auth_secret.type == "SecureString"
    error_message = "Secrets must be SecureString parameters."
  }
  assert {
    condition     = aws_ssm_parameter.database_url.value_wo == null && aws_ssm_parameter.better_auth_secret.value_wo == null
    error_message = "A write-only value must not be readable from the plan."
  }
  assert {
    condition     = aws_ssm_parameter.database_url.value_wo_version == 1 && aws_ssm_parameter.better_auth_secret.value_wo_version == 1
    error_message = "A version number must drive rotation."
  }
  assert {
    condition     = aws_ssm_parameter.database_url.name == "/hartolit/staging/database-url" && aws_ssm_parameter.better_auth_secret.name == "/hartolit/staging/better-auth-secret"
    error_message = "The names must match what the server loads."
  }
}

run "refuses_a_short_auth_secret" {
  command = plan
  variables {
    better_auth_secret = "too-short"
  }
  expect_failures = [var.better_auth_secret]
}
