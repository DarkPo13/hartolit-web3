# Plans against a mocked AWS provider: no credentials, no network, no resource.

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
  account_id = "111122223333"
}

run "staging_keeps_the_sst_settings" {
  command = plan

  assert {
    condition     = join(",", local.public_path_patterns) == "favicon.ico,icons/*,logo.png"
    error_message = "Static routes must come from public/."
  }
  assert {
    condition = (
      module.site.function_names.server == "hartolit-field-passport-staging-WebServer" &&
      module.site.assets_bucket == "hartolit-field-passport-staging-webassetsbucket-111122223333"
    )
    error_message = "Staging names must stay inside the staging prefix."
  }
}
