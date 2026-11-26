# Private assets and page cache. CloudFront reads only `_assets/`; `_cache/` stays server-only.
resource "aws_s3_bucket" "assets" {
  bucket        = local.names.bucket_name
  force_destroy = var.force_destroy_assets
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_policy" "assets" {
  bucket = aws_s3_bucket.assets.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "CloudFrontReadsPublicAssets"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${local.names.bucket_arn}/_assets/*"
        Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.this.arn } }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [local.names.bucket_arn, "${local.names.bucket_arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.assets]
}

# OpenNext's ISR queue. OpenNext sends its own group and deduplication ids.
resource "aws_sqs_queue" "revalidation" {
  name                        = local.names.queue_name
  fifo_queue                  = true
  content_based_deduplication = false
  receive_wait_time_seconds   = 20
  visibility_timeout_seconds  = 30
  sqs_managed_sse_enabled     = true
}

# OpenNext's tag cache.
resource "aws_dynamodb_table" "revalidation" {
  name                        = local.names.table_name
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "tag"
  range_key                   = "path"
  deletion_protection_enabled = var.deletion_protection

  attribute {
    name = "tag"
    type = "S"
  }

  attribute {
    name = "path"
    type = "S"
  }

  attribute {
    name = "revalidatedAt"
    type = "N"
  }

  global_secondary_index {
    name            = "revalidate"
    projection_type = "ALL"

    key_schema {
      attribute_name = "path"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "revalidatedAt"
      key_type       = "RANGE"
    }
  }

  point_in_time_recovery {
    enabled = true
  }
}
