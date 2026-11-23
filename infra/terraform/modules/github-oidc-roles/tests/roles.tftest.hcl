# Plans against a mocked AWS provider: no credentials, no network, no resource.

mock_provider "aws" {
  override_during = plan

  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/fictional" }
  }
  mock_resource "aws_iam_policy" {
    defaults = { arn = "arn:aws:iam::111122223333:policy/fictional" }
  }
}

variables {
  stage               = "staging"
  account_id          = "111122223333"
  github_repository   = "example-owner/example-repo"
  lambda_boundary_arn = "arn:aws:iam::111122223333:policy/hartolit-staging-tf-lambda-boundary"
}

run "apply_role_is_absent_by_default" {
  command = plan

  assert {
    condition     = toset(keys(aws_iam_role.github)) == toset(["plan", "deploy"])
    error_message = "Without a protected environment there must be no apply role."
  }
  assert {
    condition     = length(aws_iam_policy.apply) == 0 && length(aws_iam_role_policy_attachment.apply) == 0
    error_message = "Without a protected environment there must be no apply policies."
  }
}

run "master_push_roles_are_bound_to_master" {
  command = plan

  assert {
    condition = alltrue([
      for key in ["plan", "deploy"] :
      jsondecode(aws_iam_role.github[key].assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:example-owner/example-repo:ref:refs/heads/master" &&
      jsondecode(aws_iam_role.github[key].assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com" &&
      jsondecode(aws_iam_role.github[key].assume_role_policy).Statement[0].Action == "sts:AssumeRoleWithWebIdentity"
    ])
    error_message = "Plan and deploy must trust exactly this repository's master branch."
  }
  assert {
    condition = alltrue([
      for key in ["plan", "deploy"] :
      !strcontains(aws_iam_role.github[key].assume_role_policy, "StringLike") && !strcontains(aws_iam_role.github[key].assume_role_policy, "*")
    ])
    error_message = "A trust policy must not use wildcards."
  }
}

run "master_push_cannot_change_iam" {
  command = plan

  assert {
    condition = length([
      for statement in jsondecode(aws_iam_role_policy.deploy.policy).Statement : statement
      if statement.Effect == "Allow" && length([for action in flatten([statement.Action]) : action if startswith(action, "iam:")]) > 0
    ]) == 0
    error_message = "The deploy role must have no IAM Allow."
  }
  assert {
    condition = length([
      for action in flatten([for statement in jsondecode(aws_iam_role_policy.plan.policy).Statement : statement.Action if statement.Effect == "Allow"]) : action
      if startswith(action, "iam:") && !can(regex("^iam:(Get|List)", action))
    ]) == 0
    error_message = "The plan role may only read IAM."
  }
  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_role_policy.deploy.policy).Statement :
      statement.Effect == "Deny" && contains(flatten([statement.Action]), "iam:*") && contains(flatten([statement.Action]), "lambda:UpdateFunctionConfiguration") && contains(flatten([statement.Action]), "ssm:*") && statement.Resource == "*"
    ])
    error_message = "The deploy role must explicitly refuse IAM, function settings and SSM."
  }
  assert {
    condition = length([
      for statement in jsondecode(aws_iam_role_policy.deploy.policy).Statement : statement
      if statement.Effect == "Allow" && contains(flatten([statement.Action]), "lambda:UpdateFunctionCode") && contains(flatten([statement.Resource]), "arn:aws:lambda:us-east-1:111122223333:function:hartolit-field-passport-staging-WebEdgeFn-signer")
    ]) == 0
    error_message = "The deploy role must not replace the Lambda@Edge signer."
  }
}

run "plan_role_cannot_write_infrastructure_or_read_secrets" {
  command = plan

  assert {
    condition = alltrue(flatten([
      for statement in jsondecode(aws_iam_role_policy.plan.policy).Statement : [
        for action in flatten([statement.Action]) :
        can(regex("^[a-z0-9-]+:(Get|List|Describe)", action)) || (statement.Sid == "OwnStateLock" && contains(["s3:PutObject", "s3:DeleteObject"], action))
      ] if statement.Effect == "Allow"
    ]))
    error_message = "The plan role may only read, and write only its state lock."
  }
  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_role_policy.plan.policy).Statement :
      statement.Effect == "Deny" && contains(flatten([statement.Action]), "ssm:GetParameter*") && contains(flatten([statement.Resource]), "arn:aws:ssm:eu-central-1:111122223333:parameter/hartolit/staging/database-url")
    ])
    error_message = "The plan role must be refused the secret parameters."
  }
  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_role_policy.plan.policy).Statement :
      statement.Effect == "Deny" && statement.Action == "ssm:GetParametersByPath" && statement.Resource == "*"
    ])
    error_message = "A path read could return the secret parameters."
  }
}

run "apply_role_exists_only_behind_its_environment" {
  command = plan
  variables {
    apply_environment_protected = true
  }

  assert {
    condition     = jsondecode(aws_iam_role.github["apply"].assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:example-owner/example-repo:environment:staging-terraform-apply"
    error_message = "The apply role must trust only the protected environment."
  }
  assert {
    condition     = toset(keys(aws_iam_policy.apply)) == toset(["functions", "web", "guardrails"]) && length(aws_iam_role_policy_attachment.apply) == 3
    error_message = "The apply role must carry its three policies, guardrails included."
  }
  assert {
    condition     = alltrue([for policy in aws_iam_policy.apply : length(jsonencode(jsondecode(policy.policy))) <= 6144])
    error_message = "A managed policy is limited to 6,144 characters."
  }
}

run "apply_role_cannot_leave_the_boundary" {
  command = plan
  variables {
    apply_environment_protected = true
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_policy.apply["guardrails"].policy).Statement :
      statement.Sid == "DenyRolePowersOutsideBoundary" && statement.Effect == "Deny" &&
      contains(statement.Action, "iam:CreateRole") && contains(statement.Action, "iam:PutRolePolicy") &&
      statement.Condition.StringNotEquals["iam:PermissionsBoundary"] == "arn:aws:iam::111122223333:policy/hartolit-staging-tf-lambda-boundary"
    ])
    error_message = "Creating a role or policy outside the boundary must be denied."
  }
  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_policy.apply["functions"].policy).Statement :
      statement.Sid == "FunctionRolesOnlyInsideBoundary" && statement.Condition.StringEquals["iam:PermissionsBoundary"] == "arn:aws:iam::111122223333:policy/hartolit-staging-tf-lambda-boundary"
    ])
    error_message = "The Allow must carry the same boundary condition."
  }
  assert {
    condition     = anytrue([for statement in jsondecode(aws_iam_policy.apply["guardrails"].policy).Statement : statement.Sid == "DenyRemovingAnyBoundary" && statement.Action == "iam:DeleteRolePermissionsBoundary"])
    error_message = "Removing a boundary must be denied."
  }
  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_policy.apply["guardrails"].policy).Statement :
      statement.Sid == "DenyTouchingDeployIdentities" && statement.Action == "iam:*" &&
      contains(statement.Resource, "arn:aws:iam::111122223333:role/hartolit-staging-*") &&
      contains(statement.Resource, "arn:aws:iam::111122223333:policy/hartolit-staging-*") &&
      contains(statement.Resource, "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com")
    ])
    error_message = "The apply role must not touch its own identity, policies or the OIDC provider."
  }
  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_policy.apply["guardrails"].policy).Statement :
      statement.Sid == "DenyOtherIdentityEscalation" && contains(statement.Action, "iam:UpdateAssumeRolePolicy") && contains(statement.Action, "iam:CreateAccessKey") && contains(statement.Action, "sts:AssumeRole")
    ])
    error_message = "Other escalation paths must be denied."
  }
  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_policy.apply["functions"].policy).Statement :
      statement.Sid == "PassFunctionRolesToLambdaOnly" && toset(statement.Condition.StringEquals["iam:PassedToService"]) == toset(["lambda.amazonaws.com", "edgelambda.amazonaws.com"])
    ])
    error_message = "Function roles may be passed only to Lambda."
  }
}

run "apply_role_cannot_open_lambda_or_read_secrets" {
  command = plan
  variables {
    apply_environment_protected = true
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_policy.apply["guardrails"].policy).Statement :
      statement.Sid == "DenyPublicFunctionUrls" && statement.Condition.StringNotEquals["lambda:FunctionUrlAuthType"] == "AWS_IAM"
    ])
    error_message = "A public function URL must be denied."
  }
  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_policy.apply["guardrails"].policy).Statement :
      statement.Sid == "DenyInvokeGrantsToOthers" && statement.Condition.StringNotEquals["lambda:Principal"] == "cloudfront.amazonaws.com"
    ])
    error_message = "Invoke rights for anyone but CloudFront must be denied."
  }
  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_policy.apply["guardrails"].policy).Statement :
      statement.Sid == "DenyReadingOrWritingSecrets" && contains(statement.Action, "ssm:GetParameter*") && contains(statement.Action, "ssm:PutParameter")
    ])
    error_message = "The apply role must not read or write the secret parameters."
  }
  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_policy.apply["guardrails"].policy).Statement :
      statement.Sid == "DenyOtherRegions" && toset(statement.Condition.StringNotEquals["aws:RequestedRegion"]) == toset(["eu-central-1", "us-east-1"])
    ])
    error_message = "Other regions must be denied."
  }
  assert {
    condition = length([
      for policy in values(aws_iam_policy.apply) : policy
      if anytrue([
        for statement in jsondecode(policy.policy).Statement :
        statement.Effect == "Allow" && anytrue([for action in flatten([statement.Action]) : action == "*" || endswith(action, ":*")])
      ])
    ]) == 0
    error_message = "The apply role must have no whole-service Allow."
  }
}

run "refuses_a_wildcard_repository" {
  command = plan
  variables {
    github_repository = "example-owner/*"
  }
  expect_failures = [var.github_repository]
}

run "refuses_a_foreign_boundary" {
  command = plan
  variables {
    lambda_boundary_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
  }
  expect_failures = [var.lambda_boundary_arn]
}
