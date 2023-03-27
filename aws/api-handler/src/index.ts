import { APIGatewayProxyEvent, Context } from "aws-lambda";
import * as AWSXRay from "aws-xray-sdk-core";

import { DefaultJobRouteCollection } from "@mcma/api";
import { DynamoDbTableProvider } from "@mcma/aws-dynamodb";
import { LambdaWorkerInvoker } from "@mcma/aws-lambda-worker-invoker";
import { ApiGatewayApiController } from "@mcma/aws-api-gateway";
import { ConsoleLoggerProvider } from "@mcma/core";

const AWS = AWSXRay.captureAWS(require("aws-sdk"));

const dbTableProvider = new DynamoDbTableProvider(new AWS.DynamoDB());
const loggerProvider = new ConsoleLoggerProvider("ffmpeg-service-api-handler");
const workerInvoker = new LambdaWorkerInvoker(new AWS.Lambda());

const routes = new DefaultJobRouteCollection(dbTableProvider, workerInvoker);

const restController = new ApiGatewayApiController(routes, loggerProvider);

export async function handler(event: APIGatewayProxyEvent, context: Context) {
    console.log(JSON.stringify(event, null, 2));
    console.log(JSON.stringify(context, null, 2));

    const logger = loggerProvider.get(context.awsRequestId);
    try {
        logger.functionStart(context.awsRequestId);
        logger.debug(event);
        logger.debug(context);

        return await restController.handleRequest(event, context);
    } catch (error) {
        logger.error(error);
        throw error;
    } finally {
        logger.functionEnd(context.awsRequestId);
    }
}
