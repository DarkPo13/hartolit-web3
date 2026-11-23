# Every run is a plan against a mocked AWS provider: no credentials, no network, no resource.
# scripts/terraform-mutations.mjs removes each protection and requires the named run to fail.

mock_provider "aws" {
  override_during = plan

  mock_resource "aws_cloudfront_distribution" {
    defaults = {
      id          = "EFICTIONAL0000"
      arn         = "arn:aws:cloudfront::111122223333:distribution/EFICTIONAL0000"
      domain_name = "dfictional.cloudfront.net"
    }
  }
  mock_resource "aws_cloudfront_function" {
    defaults = { arn = "arn:aws:cloudfront::111122223333:function/fictional" }
  }
  mock_resource "aws_cloudfront_cache_policy" {
    defaults = { id = "11111111-1111-4111-8111-111111111111" }
  }
  mock_resource "aws_cloudfront_origin_access_control" {
    defaults = { id = "EFICTIONALOAC" }
  }
  mock_resource "aws_lambda_function" {
    defaults = {
      arn           = "arn:aws:lambda:eu-central-1:111122223333:function:fictional"
      qualified_arn = "arn:aws:lambda:us-east-1:111122223333:function:fictional:1"
      version       = "1"
    }
  }
  mock_resource "aws_lambda_function_url" {
    defaults = { function_url = "https://fictional.lambda-url.eu-central-1.on.aws/" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/fictional" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = {
      id                          = "fictional-bucket"
      arn                         = "arn:aws:s3:::fictional-bucket"
      bucket_regional_domain_name = "fictional-bucket.s3.eu-central-1.amazonaws.com"
    }
  }
  mock_resource "aws_sqs_queue" {
    defaults = {
      arn = "arn:aws:sqs:eu-central-1:111122223333:fictional.fifo"
      url = "https://sqs.eu-central-1.amazonaws.com/111122223333/fictional.fifo"
    }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:eu-central-1:111122223333:log-group:fictional" }
  }
}

variables {
  stage                    = "staging"
  account_id               = "111122223333"
  permissions_boundary_arn = "arn:aws:iam::111122223333:policy/hartolit-staging-tf-lambda-boundary"
  public_path_patterns     = ["favicon.ico", "icons/*", "logo.png"]
  environment = {
    DATABASE_POOL_MAX    = "3"
    NEXT_PUBLIC_CHAIN_ID = "97"
  }
}

run "oac_signs_every_origin" {
  command = plan

  assert {
    condition     = aws_cloudfront_origin_access_control.lambda.origin_access_control_origin_type == "lambda" && aws_cloudfront_origin_access_control.lambda.signing_behavior == "always" && aws_cloudfront_origin_access_control.lambda.signing_protocol == "sigv4"
    error_message = "The Lambda OAC must always sign with SigV4."
  }
  assert {
    condition     = aws_cloudfront_origin_access_control.s3.origin_access_control_origin_type == "s3" && aws_cloudfront_origin_access_control.s3.signing_behavior == "always" && aws_cloudfront_origin_access_control.s3.signing_protocol == "sigv4"
    error_message = "The S3 OAC must always sign with SigV4."
  }
  assert {
    condition     = length(aws_cloudfront_distribution.this.origin) == 3 && alltrue([for origin in aws_cloudfront_distribution.this.origin : origin.origin_access_control_id != null && origin.origin_access_control_id != ""])
    error_message = "All three origins must use an origin access control."
  }
  assert {
    condition     = alltrue([for origin in aws_cloudfront_distribution.this.origin : origin.origin_id == "assets" || one(origin.custom_origin_config).origin_protocol_policy == "https-only"])
    error_message = "CloudFront must reach the Lambda URLs over HTTPS only."
  }
}

run "lambda_urls_refuse_direct_calls" {
  command = plan

  assert {
    condition     = aws_lambda_function_url.server.authorization_type == "AWS_IAM"
    error_message = "The server URL must require IAM."
  }
  assert {
    condition     = aws_lambda_function_url.image.authorization_type == "AWS_IAM"
    error_message = "The image URL must require IAM."
  }
  assert {
    condition = alltrue([
      for key in ["server", "image"] :
      aws_lambda_permission.cloudfront_url[key].action == "lambda:InvokeFunctionUrl" &&
      aws_lambda_permission.cloudfront_url[key].principal == "cloudfront.amazonaws.com" &&
      aws_lambda_permission.cloudfront_url[key].source_arn == "arn:aws:cloudfront::111122223333:distribution/EFICTIONAL0000"
    ])
    error_message = "lambda:InvokeFunctionUrl must be granted only to this distribution."
  }
  assert {
    condition = alltrue([
      for key in ["server", "image"] :
      aws_lambda_permission.cloudfront_invoke[key].action == "lambda:InvokeFunction" &&
      aws_lambda_permission.cloudfront_invoke[key].principal == "cloudfront.amazonaws.com" &&
      aws_lambda_permission.cloudfront_invoke[key].source_arn == "arn:aws:cloudfront::111122223333:distribution/EFICTIONAL0000" &&
      aws_lambda_permission.cloudfront_invoke[key].invoked_via_function_url == true
    ])
    error_message = "lambda:InvokeFunction must be granted only to this distribution, only through the URL."
  }
}

run "edge_signer_hashes_request_bodies" {
  command = plan

  assert {
    condition = (
      one(aws_cloudfront_distribution.this.default_cache_behavior[0].lambda_function_association).event_type == "origin-request" &&
      one(aws_cloudfront_distribution.this.default_cache_behavior[0].lambda_function_association).include_body == true &&
      one(aws_cloudfront_distribution.this.default_cache_behavior[0].lambda_function_association).lambda_arn == "arn:aws:lambda:us-east-1:111122223333:function:fictional:1"
    )
    error_message = "The default behavior must send bodies to the numbered signer version."
  }
  assert {
    condition = alltrue([
      for behavior in aws_cloudfront_distribution.this.ordered_cache_behavior :
      one(behavior.lambda_function_association).include_body == true
      if contains(behavior.allowed_methods, "POST")
    ])
    error_message = "Every behavior that accepts POST must run the signer with the body."
  }
  assert {
    condition     = aws_lambda_function.edge_signer.region == "us-east-1" && aws_lambda_function.edge_signer.publish == true && aws_lambda_function.edge_signer.architectures[0] == "x86_64"
    error_message = "Lambda@Edge needs us-east-1, a published version and x86_64."
  }
  assert {
    condition     = length(aws_lambda_function.edge_signer.environment) == 0
    error_message = "Lambda@Edge cannot have environment variables."
  }
  assert {
    condition     = strcontains(aws_iam_role.edge.assume_role_policy, "edgelambda.amazonaws.com") && strcontains(aws_iam_role.edge.assume_role_policy, "lambda.amazonaws.com")
    error_message = "The signer role must trust both Lambda services."
  }
  assert {
    condition = (
      strcontains(file("${path.module}/functions/edge-signer/index.mjs"), "x-amz-content-sha256") &&
      strcontains(file("${path.module}/functions/edge-signer/index.mjs"), "inputTruncated") &&
      strcontains(file("${path.module}/functions/edge-signer/index.mjs"), "\"POST\", \"PUT\", \"PATCH\"")
    )
    error_message = "The signer must hash POST, PUT and PATCH and refuse truncated bodies."
  }
}

run "client_ip_comes_only_from_cloudfront" {
  command = plan

  assert {
    condition     = strcontains(aws_cloudfront_function.viewer_request.code, "event.request.headers[\"x-hartolit-client-ip\"] = { value: event.viewer.ip, multiValue: [{ value: event.viewer.ip }] };")
    error_message = "The viewer function must overwrite the client IP header."
  }
  assert {
    condition     = aws_cloudfront_function.viewer_request.runtime == "cloudfront-js-2.0" && aws_cloudfront_function.viewer_request.publish == true
    error_message = "The viewer function must be published on runtime 2.0."
  }
  assert {
    condition     = length(aws_cloudfront_function.viewer_request.code) < 10240
    error_message = "CloudFront Functions are limited to 10 KB."
  }
  assert {
    condition     = one(aws_cloudfront_distribution.this.default_cache_behavior[0].function_association).event_type == "viewer-request"
    error_message = "The default behavior must run the viewer function."
  }
  assert {
    condition = alltrue([
      for behavior in aws_cloudfront_distribution.this.ordered_cache_behavior :
      one(behavior.function_association).event_type == "viewer-request"
      if behavior.target_origin_id != "assets"
    ])
    error_message = "Every behavior that reaches Lambda must run the viewer function."
  }
  assert {
    condition     = aws_lambda_function.this["server"].environment[0].variables.HARTOLIT_CLIENT_IP_SOURCE == "cloudfront"
    error_message = "The server must read the client IP from CloudFront's header."
  }
  assert {
    condition     = strcontains(aws_cloudfront_function.viewer_request.code, "x-amz-content-sha256") && strcontains(aws_cloudfront_function.viewer_request.code, "x-open-next-country")
    error_message = "The viewer function must drop signature and location headers sent by a viewer."
  }
}

run "csp_nonce_and_errors_are_never_shared" {
  command = plan

  assert {
    condition     = aws_cloudfront_cache_policy.server.min_ttl == 0 && aws_cloudfront_cache_policy.server.default_ttl == 0
    error_message = "A TTL above 0 would cache no-store pages and replay a CSP nonce."
  }
  assert {
    condition     = aws_cloudfront_distribution.this.default_cache_behavior[0].response_headers_policy_id == null || aws_cloudfront_distribution.this.default_cache_behavior[0].response_headers_policy_id == ""
    error_message = "A response headers policy could replace the app's nonce CSP."
  }
  assert {
    condition     = alltrue([for behavior in aws_cloudfront_distribution.this.ordered_cache_behavior : behavior.response_headers_policy_id == null || behavior.response_headers_policy_id == ""])
    error_message = "No behavior may override the app's security headers."
  }
  assert {
    condition     = one(one(aws_cloudfront_cache_policy.server.parameters_in_cache_key_and_forwarded_to_origin).cookies_config).cookie_behavior == "none"
    error_message = "Session cookies must not enter the cache key."
  }
  assert {
    condition     = toset(one(one(one(aws_cloudfront_cache_policy.server.parameters_in_cache_key_and_forwarded_to_origin).headers_config).headers).items) == toset(["x-open-next-cache-key", "x-forwarded-host"])
    error_message = "The server cache key must hold exactly OpenNext's two headers."
  }
  assert {
    condition     = length(aws_cloudfront_distribution.this.custom_error_response) == 11 && alltrue([for item in aws_cloudfront_distribution.this.custom_error_response : item.error_caching_min_ttl == 0])
    error_message = "CloudFront must not cache error responses."
  }
  assert {
    condition     = aws_cloudfront_distribution.this.default_cache_behavior[0].origin_request_policy_id == "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    error_message = "The server needs all viewer headers except Host."
  }
}

run "routes_match_the_opennext_output" {
  command = plan

  assert {
    condition     = [for behavior in aws_cloudfront_distribution.this.ordered_cache_behavior : behavior.path_pattern] == ["_next/image*", "_next/data/*", "_next/*", "BUILD_ID", "favicon.ico", "icons/*", "logo.png"]
    error_message = "Routes must follow OpenNext's output, with dynamic _next routes first."
  }
  assert {
    condition     = [for behavior in aws_cloudfront_distribution.this.ordered_cache_behavior : behavior.target_origin_id] == ["image", "server", "assets", "assets", "assets", "assets", "assets"]
    error_message = "Each route must reach its OpenNext origin."
  }
  assert {
    condition     = alltrue([for behavior in aws_cloudfront_distribution.this.ordered_cache_behavior : toset(behavior.allowed_methods) == toset(["GET", "HEAD"]) && behavior.origin_request_policy_id == null if behavior.target_origin_id == "assets"])
    error_message = "Static routes are read-only and forward no viewer data."
  }
  assert {
    condition     = one([for origin in aws_cloudfront_distribution.this.origin : origin.origin_path if origin.origin_id == "assets"]) == "/_assets"
    error_message = "CloudFront must read only the _assets prefix."
  }
  assert {
    condition     = alltrue(concat([aws_cloudfront_distribution.this.default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https"], [for behavior in aws_cloudfront_distribution.this.ordered_cache_behavior : behavior.viewer_protocol_policy == "redirect-to-https"]))
    error_message = "Every route must redirect to HTTPS."
  }
  assert {
    condition     = aws_cloudfront_distribution.this.price_class == "PriceClass_100"
    error_message = "Staging uses the cheapest price class."
  }
}

run "assets_bucket_is_private" {
  command = plan

  assert {
    condition = (
      aws_s3_bucket_public_access_block.assets.block_public_acls &&
      aws_s3_bucket_public_access_block.assets.block_public_policy &&
      aws_s3_bucket_public_access_block.assets.ignore_public_acls &&
      aws_s3_bucket_public_access_block.assets.restrict_public_buckets
    )
    error_message = "All four public access blocks must be on."
  }
  assert {
    condition = anytrue([
      for statement in jsondecode(aws_s3_bucket_policy.assets.policy).Statement :
      statement.Effect == "Allow" && statement.Action == "s3:GetObject" && endswith(statement.Resource, "/_assets/*") &&
      statement.Condition.StringEquals["AWS:SourceArn"] == "arn:aws:cloudfront::111122223333:distribution/EFICTIONAL0000"
    ])
    error_message = "Only this distribution may read, and only _assets."
  }
  assert {
    condition     = length([for statement in jsondecode(aws_s3_bucket_policy.assets.policy).Statement : statement if statement.Effect == "Allow"]) == 1
    error_message = "The bucket policy must have exactly one Allow."
  }
  assert {
    condition = anytrue([
      for statement in jsondecode(aws_s3_bucket_policy.assets.policy).Statement :
      statement.Effect == "Deny" && try(statement.Condition.Bool["aws:SecureTransport"], "") == "false"
    ])
    error_message = "The bucket must refuse requests without TLS."
  }
  assert {
    condition     = one(aws_s3_bucket_ownership_controls.assets.rule).object_ownership == "BucketOwnerEnforced"
    error_message = "ACLs must stay disabled."
  }
}

run "isr_matches_opennext" {
  command = plan

  assert {
    condition     = aws_sqs_queue.revalidation.fifo_queue && !aws_sqs_queue.revalidation.content_based_deduplication && aws_sqs_queue.revalidation.receive_wait_time_seconds == 20 && aws_sqs_queue.revalidation.visibility_timeout_seconds >= aws_lambda_function.this["revalidation"].timeout
    error_message = "The ISR queue must be FIFO, long-polled and outlast its subscriber."
  }
  assert {
    condition     = aws_lambda_event_source_mapping.revalidation.batch_size == 5
    error_message = "The subscriber batch must stay 5."
  }
  assert {
    condition     = aws_dynamodb_table.revalidation.billing_mode == "PAY_PER_REQUEST" && aws_dynamodb_table.revalidation.hash_key == "tag" && aws_dynamodb_table.revalidation.range_key == "path"
    error_message = "The tag table must be on demand with keys tag and path."
  }
  assert {
    condition     = one(aws_dynamodb_table.revalidation.global_secondary_index).name == "revalidate" && one(aws_dynamodb_table.revalidation.global_secondary_index).projection_type == "ALL"
    error_message = "OpenNext queries the revalidate index."
  }
  assert {
    condition     = one(aws_dynamodb_table.revalidation.point_in_time_recovery).enabled
    error_message = "Point-in-time recovery must stay on."
  }
  assert {
    condition = (
      aws_lambda_function.this["server"].environment[0].variables.CACHE_BUCKET_KEY_PREFIX == "_cache" &&
      aws_lambda_function.this["server"].environment[0].variables.CACHE_BUCKET_NAME == "hartolit-field-passport-staging-webassetsbucket-111122223333" &&
      aws_lambda_function.this["server"].environment[0].variables.CACHE_DYNAMO_TABLE == aws_dynamodb_table.revalidation.name &&
      aws_lambda_function.this["server"].environment[0].variables.REVALIDATION_QUEUE_REGION == "eu-central-1" &&
      aws_lambda_function.this["image"].environment[0].variables.BUCKET_KEY_PREFIX == "_assets"
    )
    error_message = "OpenNext must receive its cache settings."
  }
}

run "every_role_has_the_boundary" {
  command = plan

  assert {
    condition     = length(aws_iam_role.function) == 4 && alltrue([for role in aws_iam_role.function : role.permissions_boundary == "arn:aws:iam::111122223333:policy/hartolit-staging-tf-lambda-boundary"])
    error_message = "Every function role must carry the boundary."
  }
  assert {
    condition     = aws_iam_role.edge.permissions_boundary == "arn:aws:iam::111122223333:policy/hartolit-staging-tf-lambda-boundary"
    error_message = "The signer role must carry the boundary."
  }
}

run "roles_are_least_privilege" {
  command = plan

  assert {
    condition = alltrue(flatten([
      for policy in aws_iam_role_policy.function : [
        for statement in jsondecode(policy.policy).Statement :
        statement.Effect == "Allow" && !contains(flatten([statement.Action]), "*") && !contains(flatten([statement.Resource]), "*") &&
        length([for action in flatten([statement.Action]) : action if startswith(action, "iam:") || endswith(action, ":*")]) == 0
      ]
    ]))
    error_message = "A function role must have no wildcard, IAM or whole-service permission."
  }
  assert {
    condition = alltrue([
      for key in ["image", "revalidation", "seeder"] :
      !strcontains(aws_iam_role_policy.function[key].policy, "ssm:") && !strcontains(aws_iam_role_policy.function[key].policy, "kms:")
    ])
    error_message = "Only the server may read secrets."
  }
  assert {
    condition     = !strcontains(aws_iam_role_policy.function["server"].policy, "ssm:GetParametersByPath") && strcontains(aws_iam_role_policy.function["server"].policy, "kms:ViaService") && strcontains(aws_iam_role_policy.function["server"].policy, "kms:EncryptionContext:PARAMETER_ARN")
    error_message = "The server may decrypt only its own parameters, through SSM."
  }
  assert {
    condition     = !strcontains(aws_iam_role_policy.function["image"].policy, "s3:PutObject") && strcontains(aws_iam_role_policy.function["image"].policy, "/_assets/*")
    error_message = "The image function only reads public assets."
  }
  assert {
    condition     = !strcontains(aws_iam_role_policy.function["server"].policy, "${"arn:aws:s3:::hartolit-field-passport-staging-webassetsbucket-111122223333"}/*\"")
    error_message = "The server must not reach the whole bucket."
  }
}

run "secrets_stay_out_of_lambda_settings" {
  command = plan

  assert {
    condition = length(setintersection(keys(aws_lambda_function.this["server"].environment[0].variables), [
      "DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL",
    ])) == 0
    error_message = "Secrets must reach the server through SSM, not Lambda settings."
  }
  assert {
    condition     = aws_lambda_function.this["server"].handler == "hartolit-entry.handler"
    error_message = "The server must start through the entry that loads SSM first."
  }
  assert {
    condition     = keys(jsondecode(aws_lambda_function.this["server"].environment[0].variables.HARTOLIT_SECRET_PARAMETERS)) == ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "DATABASE_URL", "NEXT_PUBLIC_APP_URL"]
    error_message = "The entry must load exactly the four runtime values."
  }
  assert {
    condition     = aws_lambda_function.this["server"].environment[0].variables.NEXT_PUBLIC_DEMO_MODE == "false"
    error_message = "Demo mode must stay off."
  }
  assert {
    condition     = aws_ssm_parameter.site_url.type == "String" && aws_ssm_parameter.site_url.name == "/hartolit/staging/site-url"
    error_message = "Only the non-secret site URL is managed here."
  }
}

run "nothing_is_billed_while_idle" {
  command = plan

  assert {
    condition     = alltrue([for fn in aws_lambda_function.this : length(fn.vpc_config) == 0])
    error_message = "A VPC would need a NAT gateway."
  }
  assert {
    condition     = length(aws_lambda_function.edge_signer.vpc_config) == 0
    error_message = "Lambda@Edge cannot run in a VPC."
  }
  assert {
    condition     = aws_lambda_function.this["server"].memory_size == 1024 && aws_lambda_function.this["server"].timeout == 60 && aws_lambda_function.this["server"].architectures[0] == "arm64" && aws_lambda_function.this["server"].runtime == "nodejs24.x"
    error_message = "Server settings must match D79."
  }
  assert {
    condition     = aws_lambda_function.this["image"].memory_size == 512 && aws_lambda_function.this["image"].timeout == 25
    error_message = "Image settings must match D79."
  }
  assert {
    condition     = aws_cloudwatch_log_group.function["server"].retention_in_days == 7 && aws_cloudwatch_log_group.function["image"].retention_in_days == 3
    error_message = "Logs must expire."
  }
}

run "refuses_a_database_url_in_lambda_settings" {
  command = plan
  variables {
    environment = { DATABASE_URL = "fictional" }
  }
  expect_failures = [var.environment]
}

run "refuses_an_auth_secret_in_lambda_settings" {
  command = plan
  variables {
    environment = { BETTER_AUTH_SECRET = "fictional" }
  }
  expect_failures = [var.environment]
}

run "refuses_a_connection_string_under_another_name" {
  command = plan
  variables {
    environment = { NOTHING_TO_SEE = "postgresql://fictional@db.example.invalid/app" }
  }
  expect_failures = [var.environment]
}

run "refuses_overriding_the_client_ip_source" {
  command = plan
  variables {
    environment = { HARTOLIT_CLIENT_IP_SOURCE = "forwarded-for" }
  }
  expect_failures = [var.environment]
}

run "refuses_turning_on_demo_mode" {
  command = plan
  variables {
    environment = { NEXT_PUBLIC_DEMO_MODE = "true" }
  }
  expect_failures = [var.environment]
}

run "refuses_a_foreign_boundary" {
  command = plan
  variables {
    permissions_boundary_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
  }
  expect_failures = [var.permissions_boundary_arn]
}

run "refuses_a_public_pattern_over_dynamic_routes" {
  command = plan
  variables {
    public_path_patterns = ["api/*"]
  }
  expect_failures = [var.public_path_patterns]
}

run "refuses_force_destroy_in_production" {
  command = plan
  variables {
    stage                    = "production"
    permissions_boundary_arn = "arn:aws:iam::111122223333:policy/hartolit-production-tf-lambda-boundary"
    force_destroy_assets     = true
  }
  expect_failures = [var.force_destroy_assets]
}

run "refuses_unprotected_table_in_production" {
  command = plan
  variables {
    stage                    = "production"
    permissions_boundary_arn = "arn:aws:iam::111122223333:policy/hartolit-production-tf-lambda-boundary"
    deletion_protection      = false
  }
  expect_failures = [var.deletion_protection]
}
