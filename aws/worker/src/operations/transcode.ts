import { S3Locator, S3LocatorProperties } from "@mcma/aws-s3";
import { S3 } from "aws-sdk";
import * as stream from "stream";
import * as ffmpeg from "fluent-ffmpeg";
import * as mime from "mime-types";

import { ProcessJobAssignmentHelper, ProviderCollection } from "@mcma/worker";
import { Logger, McmaException, TransformJob } from "@mcma/core";
import { generateFilePrefix } from "./utils";

const { OutputBucket } = process.env;

async function ffmpegTranscode(jobAssignmentHelper: ProcessJobAssignmentHelper<TransformJob>, params: { [key: string]: any }, inputFile: S3LocatorProperties, outputFile: S3LocatorProperties, s3: S3, logger: Logger) {
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

        const videoCodec = params["videoCodec"] ?? "libx264";
        const audioCodec = params["audioCodec"] ?? "aac";
        const format = params["format"] ?? "mp4";

        let pipeline = ffmpeg(inputFile.url)
            .setFfmpegPath("/opt/ffmpeg")
            .videoCodec(videoCodec)
            .audioCodec(audioCodec);

        if (params["videoBitRate"]) {
            pipeline.videoBitrate(params["videoBitRate"]);
        }
        if (params["width"] || params["height"]) {
            pipeline.size(`${params["width"] ?? "?"}x${params["height"] ?? "?"}`);
        }
        if (params["aspectRatio"]) {
            pipeline.aspect(params["aspectRatio"]);
        }
        if (params["autoPadding"]) {
            pipeline.autopad();
        }

        pipeline.outputFormat(format);
        switch (format) {
            case "mp4":
            case "mov":
                pipeline.outputOptions(["-movflags empty_moov"]);
                break;
        }

        pipeline.output(writableStream)
            .on("error", function (err, stdout, stderr) {
                logger.error(err);
                logger.error("ffmpeg stdout: " + stdout);
                logger.error("ffmpeg stderr: " + stderr);
                reject(err);
            })
            .on("progress", function (progress) {
                logger.info(progress);
            })
            .run();
    }));
}

export async function transcode(providers: ProviderCollection, jobAssignmentHelper: ProcessJobAssignmentHelper<TransformJob>, ctx: { s3: S3 }) {
    const logger = jobAssignmentHelper.logger;
    const jobInput = jobAssignmentHelper.jobInput;

    logger.info("Execute ffmpeg on input file");
    let inputFile = jobInput.get<S3LocatorProperties>("inputFile");

    if (!inputFile.url) {
        throw new McmaException("Not able to obtain input file");
    }

    const format = jobInput["format"] ?? "mp4";

    const outputFile = new S3Locator({
        url: ctx.s3.getSignedUrl("getObject", {
            Bucket: OutputBucket,
            Key: generateFilePrefix(inputFile.url) + "." + format,
            Expires: 12 * 3600
        })
    });

    const data = await ffmpegTranscode(jobAssignmentHelper, jobInput, inputFile, outputFile, ctx.s3, logger);
    logger.info(data);

    jobAssignmentHelper.jobOutput.set("outputFile", outputFile);

    logger.info("Marking JobAssignment as completed");
    await jobAssignmentHelper.complete();
}
