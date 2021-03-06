import * as ffmpeg from "fluent-ffmpeg";
import * as stream from "stream";
import * as mime from "mime-types";
import { S3 } from "aws-sdk";

import { McmaException, TransformJob } from "@mcma/core";
import { ProcessJobAssignmentHelper, ProviderCollection } from "@mcma/worker";
import { S3Locator, S3LocatorProperties } from "@mcma/aws-s3";
import { generateFilePrefix } from "./utils";

const { OutputBucket } = process.env;

async function ffmpegExtractThumbnail(params: { [key: string]: any }, inputFile: S3LocatorProperties, outputFile: S3LocatorProperties, s3: S3) {
    return new Promise<S3.ManagedUpload.SendData>(((resolve, reject) => {

        const writableStream = new stream.PassThrough();

        s3.upload({
            Bucket: outputFile.bucket,
            Key: outputFile.key,
            Body: writableStream,
            ContentType: mime.lookup(outputFile.key) || "application/octet-stream"
        }, function (err: Error, data: S3.ManagedUpload.SendData) {
            if (err) {
                return reject(err);
            }
            return resolve(data);
        });

        let pipeline = ffmpeg(inputFile.url)
            .setFfmpegPath("/opt/ffmpeg")
            .seekInput(params["position"] ?? 1)
            .frames(1);

        if (params["width"] || params["height"]) {
            pipeline = pipeline.size(`${params["width"] ?? "?"}x${params["height"] ?? "?"}`);
        }
        if (params["aspectRatio"]) {
            pipeline = pipeline.aspect(params["aspectRatio"]);
        }
        if (params["autoPadding"]) {
            pipeline = pipeline.autopad();
        }

        pipeline.outputFormat("mjpeg")
            .output(writableStream)
            .on("error", function (err, stdout, stderr) {
                reject(err);
            })
            .run();
    }));
}

export async function extractThumbnail(providers: ProviderCollection, jobAssignmentHelper: ProcessJobAssignmentHelper<TransformJob>, ctx: { s3: S3 }) {
    const logger = jobAssignmentHelper.logger;
    const jobInput = jobAssignmentHelper.jobInput;

    logger.info("Execute ffmpeg on input file");
    let inputFile = jobInput.get<S3LocatorProperties>("inputFile");

    if (!inputFile.url) {
        throw new McmaException("Not able to obtain input file");
    }

    const outputFile = new S3Locator({
        url: ctx.s3.getSignedUrl("getObject", {
            Bucket: OutputBucket,
            Key: generateFilePrefix(inputFile.url) + ".jpg",
            Expires: 12 * 3600
        })
    });

    const data = await ffmpegExtractThumbnail(jobInput, inputFile, outputFile, ctx.s3);
    logger.info(data);

    jobAssignmentHelper.jobOutput.set("outputFile", outputFile);

    logger.info("Marking JobAssignment as completed");
    await jobAssignmentHelper.complete();
}
