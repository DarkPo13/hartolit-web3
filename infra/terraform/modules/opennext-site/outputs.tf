output "site_url" {
  description = "Public address of the site."
  value       = aws_ssm_parameter.site_url.value
  sensitive   = true
}

output "distribution_id" {
  description = "CloudFront distribution, for the deploy's invalidation."
  value       = aws_cloudfront_distribution.this.id
}

output "distribution_domain_name" {
  description = "CloudFront address."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "assets_bucket" {
  description = "Bucket the deploy uploads `_assets` and `_cache` to."
  value       = aws_s3_bucket.assets.bucket
}

output "function_names" {
  description = "Functions whose code the deploy updates."
  value       = { for key, fn in aws_lambda_function.this : key => fn.function_name }
}

output "edge_signer_version" {
  description = "Published version of the Lambda@Edge signer."
  value       = aws_lambda_function.edge_signer.version
}
