output "service_definition" {
  value = {
    name      = var.name
    auth_type = local.service_auth_type
    resources = [
      {
        resource_type = "JobAssignment"
        http_endpoint = "${local.service_url}/job-assignments"
      }
    ]
    job_type     = "TransformJob"
    job_profiles = [
      {
        name             = "FFmpegExtractThumbnail"
        input_parameters = [
          {
            parameter_name = "inputFile"
            parameter_type = "Locator"
          },
        ]
        optional_input_parameters = [
          {
            parameter_name = "position"
            parameter_type = "number | string"
          },
          {
            parameter_name = "width"
            parameter_type = "number"
          },
          {
            parameter_name = "height"
            parameter_type = "number"
          },
          {
            parameter_name = "aspectRatio"
            parameter_type = "string | number"
          },
          {
            parameter_name = "autoPadding"
            parameter_type = "boolean"
          }
        ]
        output_parameters = [
          {
            parameter_name = "outputFile"
            parameter_type = "S3Locator"
          }
        ]
      },
      {
        name             = "FFmpegTranscode"
        input_parameters = [
          {
            parameter_name = "inputFile"
            parameter_type = "Locator"
          },
        ]
        optional_input_parameters = [
          {
            parameter_name = "videoCodec"
            parameter_type = "string"
          },
          {
            parameter_name = "audioCodec"
            parameter_type = "string"
          },
          {
            parameter_name = "format"
            parameter_type = "string"
          },
          {
            parameter_name = "videoBitRate"
            parameter_type = "number"
          },
          {
            parameter_name = "audioBitRate"
            parameter_type = "number"
          },
          {
            parameter_name = "width"
            parameter_type = "number"
          },
          {
            parameter_name = "height"
            parameter_type = "number"
          },
          {
            parameter_name = "aspectRatio"
            parameter_type = "string | number"
          },
          {
            parameter_name = "autoPadding"
            parameter_type = "boolean"
          }
        ]
        output_parameters = [
          {
            parameter_name = "outputFile"
            parameter_type = "S3Locator"
          }
        ]
      }
    ]
  }
}


output "auth_type" {
  value = local.service_auth_type
}

output "job_assignments_url" {
  value = "${local.service_url}/job-assignments"
}

# exporting all resources from module
output "aws_iam_role" {
  value = {
    api_handler = aws_iam_role.api_handler
    worker      = aws_iam_role.worker
  }
}

output "aws_dynamodb_table" {
  value = {
    service_table = aws_dynamodb_table.service_table
  }
}

output "aws_lambda_function" {
  value = {
    api_handler = aws_lambda_function.api_handler
    worker      = aws_lambda_function.worker
  }
}

output "aws_apigatewayv2_api" {
  value = {
    service_api = aws_apigatewayv2_api.service_api
  }
}

output "aws_apigatewayv2_integration" {
  value = {
    service_api = aws_apigatewayv2_integration.service_api
  }
}

output "aws_apigatewayv2_route" {
  value = {
    service_api_default = aws_apigatewayv2_route.service_api_default
    service_api_options = aws_apigatewayv2_route.service_api_options
  }
}

output "aws_lambda_permission" {
  value = {
    service_api_default = aws_lambda_permission.service_api_default
    service_api_options = aws_lambda_permission.service_api_options
  }
}

output "aws_apigatewayv2_stage" {
  value = {
    service_api = aws_apigatewayv2_stage.service_api
  }
}
