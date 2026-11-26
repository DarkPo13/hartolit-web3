# Plans against a mocked AWS provider: no credentials, no network, no resource.

mock_provider "aws" {
  override_during = plan

  mock_resource "aws_s3_bucket" {
    defaults = {
      id  = "fictional-state"
      arn = "arn:aws:s3:::fictional-state"
    }
  }
  mock_resource "aws_iam_policy" {
    defaults = { arn = "arn:aws:iam::111122223333:policy/fictional" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/fictional" }
  }
}

variables {
  stage             = "staging"
  account_id        = "111122223333"
  github_repository = "example-owner/example-repo"
}

run "state_bucket_is_protected" {
  command = plan

  assert {
    condition     = one(aws_s3_bucket_versioning.state.versioning_configuration).status == "Enabled"
    error_message = "State must be versioned."
  }
  assert {
    condition     = one(one(aws_s3_bucket_server_side_encryption_configuration.state.rule).apply_server_side_encryption_by_default).sse_algorithm == "AES256"
    error_message = "State must be encrypted."
  }
  assert {
    condition = (
      aws_s3_bucket_public_access_block.state.block_public_acls &&
      aws_s3_bucket_public_access_block.state.block_public_policy &&
      aws_s3_bucket_public_access_block.state.ignore_public_acls &&
      aws_s3_bucket_public_access_block.state.restrict_public_buckets
    )
    error_message = "State must not be public."
  }
  assert {
    condition     = jsondecode(aws_s3_bucket_policy.state.policy).Statement[0].Effect == "Deny" && jsondecode(aws_s3_bucket_policy.state.policy).Statement[0].Condition.Bool["aws:SecureTransport"] == "false"
    error_message = "State must refuse requests without TLS."
  }
  assert {
    condition     = aws_s3_bucket.state.bucket == "hartolit-terraform-state-staging-111122223333"
    error_message = "Each account has its own state bucket."
  }
}

run "state_history_is_kept_and_locks_release" {
  command = plan

  assert {
    condition = anytrue([
      for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement :
      statement.Effect == "Deny" && statement.Principal == "*" && try(statement.Condition, null) == null &&
      contains(flatten([statement.Action]), "s3:DeleteBucket") && contains(flatten([statement.Action]), "s3:DeleteObjectVersion")
    ])
    error_message = "Nobody may delete the state bucket or erase earlier state versions."
  }
  assert {
    condition = alltrue(flatten([
      for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement : [
        for action in flatten([statement.Action]) :
        !contains(["s3:DeleteObject", "s3:Delete*", "s3:*", "*"], action)
      ] if statement.Effect == "Deny" && try(statement.Condition, null) == null
    ]))
    error_message = "Terraform releases its lock with DeleteObject; no unconditional Deny may block it."
  }
  assert {
    condition = (
      one(one(aws_s3_bucket_lifecycle_configuration.state.rule).noncurrent_version_expiration).noncurrent_days == 90 &&
      one(one(aws_s3_bucket_lifecycle_configuration.state.rule).expiration).expired_object_delete_marker == true
    )
    error_message = "Old versions expire after 90 days and leftover lock markers are cleaned."
  }
}

run "boundary_is_narrow" {
  command = plan

  assert {
    condition     = aws_iam_policy.lambda_boundary.name == "hartolit-staging-tf-lambda-boundary"
    error_message = "This is a new policy; the SST boundary must stay untouched."
  }
  assert {
    condition = alltrue(flatten([
      for statement in jsondecode(aws_iam_policy.lambda_boundary.policy).Statement : [
        statement.Effect == "Allow",
        !contains(flatten([statement.Resource]), "*"),
        length([for action in flatten([statement.Action]) : action if action == "*" || endswith(action, ":*") || startswith(action, "iam:") || startswith(action, "sts:") || startswith(action, "lambda:")]) == 0,
      ]
    ]))
    error_message = "The boundary must have no wildcard and no IAM, STS or Lambda action."
  }
  assert {
    condition     = !strcontains(aws_iam_policy.lambda_boundary.policy, "ssm:GetParametersByPath") && !strcontains(aws_iam_policy.lambda_boundary.policy, "ssm:PutParameter")
    error_message = "The boundary may only read named parameters."
  }
  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_policy.lambda_boundary.policy).Statement :
      statement.Action == "kms:Decrypt" && statement.Condition.StringEquals["kms:ViaService"] == "ssm.eu-central-1.amazonaws.com" && length(statement.Condition.StringEquals["kms:EncryptionContext:PARAMETER_ARN"]) == 2
    ])
    error_message = "Decryption must be limited to the two secrets, through SSM."
  }
}

run "only_the_plan_role_by_default" {
  command = plan

  assert {
    condition     = keys(module.github_roles.role_arns) == ["plan"]
    error_message = "Bootstrap must create neither the deploy nor the apply role by default."
  }
}

run "production_bootstrap_is_refused" {
  command = plan
  variables {
    stage = "production"
  }
  expect_failures = [terraform_data.production_guard]
}
