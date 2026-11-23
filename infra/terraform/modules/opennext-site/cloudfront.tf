locals {
  # CloudFront's Managed-AllViewerExceptHostHeader: the Lambda URL needs its own Host.
  all_viewer_except_host_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"

  all_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
  read_methods = ["GET", "HEAD"]

  # First match wins, so the two dynamic `_next` routes come before `_next/*`.
  dynamic_behaviors = [
    { path = "_next/image*", origin = "image", methods = ["GET", "HEAD", "OPTIONS"], signer = false },
    { path = "_next/data/*", origin = "server", methods = local.all_methods, signer = true },
  ]
  static_behaviors = concat(["_next/*", "BUILD_ID"], var.public_path_patterns)

  # Errors must not be cached: one bad request must not answer for other visitors.
  uncached_error_codes = [400, 403, 404, 405, 414, 416, 500, 501, 502, 503, 504]
}

resource "aws_cloudfront_origin_access_control" "lambda" {
  name                              = "${local.names.prefix}LambdaOac"
  description                       = "Signs every request to the Lambda function URLs"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${local.names.prefix}S3Oac"
  description                       = "Signs every request to the assets bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# TTL 0/0: a response is cached only when the app says so. Pages answer `no-store` with a
# per-request CSP nonce, and a minimum TTL above 0 would replay one nonce to other visitors.
resource "aws_cloudfront_cache_policy" "server" {
  name        = "${local.names.prefix}ServerCache"
  comment     = "Server responses; honours Cache-Control"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "whitelist"

      headers {
        items = ["x-open-next-cache-key", "x-forwarded-host"]
      }
    }

    query_strings_config {
      query_string_behavior = "all"
    }
  }
}

# Static files vary by path only, so a viewer's headers cannot split or bust their cache.
resource "aws_cloudfront_cache_policy" "assets" {
  name        = "${local.names.prefix}AssetsCache"
  comment     = "Static files; honours Cache-Control"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_function" "viewer_request" {
  name    = "${local.names.prefix}ViewerRequest"
  comment = "Client IP, forwarded host, cache key"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/functions/viewer-request.js")
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  comment             = "Hartolit ${var.stage}"
  price_class         = var.price_class
  wait_for_deployment = false

  origin {
    origin_id                = "server"
    domain_name              = split("/", aws_lambda_function_url.server.function_url)[2]
    origin_access_control_id = aws_cloudfront_origin_access_control.lambda.id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      # The server function's timeout; 60 s is CloudFront's default ceiling.
      origin_read_timeout = 60
    }
  }

  origin {
    origin_id                = "image"
    domain_name              = split("/", aws_lambda_function_url.image.function_url)[2]
    origin_access_control_id = aws_cloudfront_origin_access_control.lambda.id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 25
    }
  }

  origin {
    origin_id                = "assets"
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_path              = "/_assets"
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  default_cache_behavior {
    target_origin_id         = "server"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = local.all_methods
    cached_methods           = local.read_methods
    compress                 = true
    cache_policy_id          = aws_cloudfront_cache_policy.server.id
    origin_request_policy_id = local.all_viewer_except_host_policy_id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.viewer_request.arn
    }

    lambda_function_association {
      event_type   = "origin-request"
      lambda_arn   = aws_lambda_function.edge_signer.qualified_arn
      include_body = true
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = local.dynamic_behaviors

    content {
      path_pattern             = ordered_cache_behavior.value.path
      target_origin_id         = ordered_cache_behavior.value.origin
      viewer_protocol_policy   = "redirect-to-https"
      allowed_methods          = ordered_cache_behavior.value.methods
      cached_methods           = local.read_methods
      compress                 = true
      cache_policy_id          = aws_cloudfront_cache_policy.server.id
      origin_request_policy_id = local.all_viewer_except_host_policy_id

      function_association {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.viewer_request.arn
      }

      dynamic "lambda_function_association" {
        for_each = ordered_cache_behavior.value.signer ? [1] : []

        content {
          event_type   = "origin-request"
          lambda_arn   = aws_lambda_function.edge_signer.qualified_arn
          include_body = true
        }
      }
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = local.static_behaviors

    content {
      path_pattern           = ordered_cache_behavior.value
      target_origin_id       = "assets"
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = local.read_methods
      cached_methods         = local.read_methods
      compress               = true
      cache_policy_id        = aws_cloudfront_cache_policy.assets.id
    }
  }

  dynamic "custom_error_response" {
    for_each = local.uncached_error_codes

    content {
      error_code            = custom_error_response.value
      error_caching_min_ttl = 0
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
