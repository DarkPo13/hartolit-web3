# Lambda URLs behind OAC need a SHA-256 of the body on POST, PUT and PATCH. Browsers do not
# send one, so this origin-request function adds it. Lambda@Edge runs only from us-east-1,
# on x86_64, without environment variables, and from a numbered version.
data "archive_file" "edge_signer" {
  type             = "zip"
  source_file      = "${path.module}/functions/edge-signer/index.mjs"
  output_path      = "${path.root}/.build/${var.stage}-edge-signer.zip"
  output_file_mode = "0644"
}

resource "aws_iam_role" "edge" {
  name                 = local.names.role_names.edge
  permissions_boundary = var.permissions_boundary_arn
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = ["lambda.amazonaws.com", "edgelambda.amazonaws.com"] }
    }]
  })
}

resource "aws_iam_role_policy" "edge" {
  name = "edge-logs"
  role = aws_iam_role.edge.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "OwnEdgeLogs"
      Effect   = "Allow"
      Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = [local.names.edge_log_group_arn, "${local.names.edge_log_group_arn}:*"]
    }]
  })
}

resource "aws_lambda_function" "edge_signer" {
  region = "us-east-1"

  function_name    = local.names.edge_function_name
  description      = "Hartolit ${var.stage} OAC body signer"
  role             = aws_iam_role.edge.arn
  runtime          = "nodejs24.x"
  handler          = "index.handler"
  architectures    = ["x86_64"]
  memory_size      = 128
  timeout          = 5
  publish          = true
  filename         = data.archive_file.edge_signer.output_path
  source_code_hash = data.archive_file.edge_signer.output_base64sha256

  depends_on = [aws_iam_role_policy.edge]
}
