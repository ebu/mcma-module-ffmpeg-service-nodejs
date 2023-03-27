import { Context } from "aws-lambda";
import * as AWSXRay from "aws-xray-sdk-core";

import { AuthProvider, ResourceManagerProvider } from "@mcma/client";
import { ProcessJobAssignmentOperation, ProviderCollection, Worker, WorkerRequest, WorkerRequestProperties } from "@mcma/worker";
import { DynamoDbTableProvider } from "@mcma/aws-dynamodb";
import { AwsCloudWatchLoggerProvider, getLogGroupName } from "@mcma/aws-logger";
import { awsV4Auth } from "@mcma/aws-client";
import { TransformJob } from "@mcma/core";
import { extractAudio, extractThumbnail, transcode } from "./operations";

const AWS = AWSXRay.captureAWS(require("aws-sdk"));

const authProvider = new AuthProvider().add(awsV4Auth(AWS));
const dbTableProvider = new DynamoDbTableProvider();
const loggerProvider = new AwsCloudWatchLoggerProvider("ffmpeg-service-worker", getLogGroupName());
const resourceManagerProvider = new ResourceManagerProvider(authProvider);

const providerCollection = new ProviderCollection({
    authProvider,
    dbTableProvider,
    loggerProvider,
    resourceManagerProvider
});

const processJobAssignmentOperation =
    new ProcessJobAssignmentOperation(TransformJob)
        .addProfile("FFmpegExtractAudio", extractAudio)
        .addProfile("FFmpegExtractThumbnail", extractThumbnail)
        .addProfile("FFmpegTranscode", transcode);

const worker =
    new Worker(providerCollection)
        .addOperation(processJobAssignmentOperation);

export async function handler(event: WorkerRequestProperties, context: Context) {
    const logger = loggerProvider.get(context.awsRequestId, event.tracker);

    try {
        logger.functionStart(context.awsRequestId);
        logger.debug(event);
        logger.debug(context);

        await worker.doWork(new WorkerRequest(event, logger), {
            awsRequestId: context.awsRequestId,
            s3: new AWS.S3({ signatureVersion: "v4" }),
        });
    } catch (error) {
        logger.error("Error occurred when handling operation '" + event.operationName + "'");
        logger.error(error);
    } finally {
        logger.functionEnd(context.awsRequestId);
        await loggerProvider.flush();
    }
}
