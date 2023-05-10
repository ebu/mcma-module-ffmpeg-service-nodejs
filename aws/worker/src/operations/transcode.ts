import { S3Locator } from "@mcma/aws-s3";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";

import * as ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";
import * as mime from "mime-types";
import { v4 as uuidv4 } from "uuid";

import { ProcessJobAssignmentHelper, ProviderCollection } from "@mcma/worker";
import { Logger, McmaException, TransformJob } from "@mcma/core";
import { generateFilePrefix } from "./utils";

const { OUTPUT_BUCKET } = process.env;

async function ffmpegTranscode(params: { [key: string]: any }, inputFile: S3Locator, outputFile: string, logger: Logger) {
    return new Promise<void>(((resolve, reject) => {

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
        if (params["audioBitRate"]) {
            pipeline.audioBitrate(params["audioBitRate"]);
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
                pipeline.outputOptions(["-movflags faststart"]);
                break;
        }

        pipeline.output(outputFile)
            .on("error", (err, stdout, stderr) => {
                logger.error(err);
                logger.error("ffmpeg stdout: " + stdout);
                logger.error("ffmpeg stderr: " + stderr);
                reject(err);
            })
            .on("progress", (progress) => {
                logger.info(progress);
            })
            .on("end", () => {
                resolve();
            })
            .run();
    }));
}

export async function transcode(providers: ProviderCollection, jobAssignmentHelper: ProcessJobAssignmentHelper<TransformJob>, ctx: { s3Client: S3Client }) {
    const logger = jobAssignmentHelper.logger;
    const jobInput = jobAssignmentHelper.jobInput;

    logger.info("Execute ffmpeg on input file");
    let inputFile = jobInput.inputFile as S3Locator;

    if (!inputFile.url) {
        throw new McmaException("Not able to obtain input file");
    }

    const format = jobInput["format"] ?? "mp4";

    const tempFile = `/tmp/${uuidv4()}.${format}`;
    try {

        logger.info(`Begin transcoding input to ${tempFile}`);
        await ffmpegTranscode(jobInput, inputFile, tempFile, logger);

        const outputFile = new S3Locator({
            url: await getSignedUrl(
                ctx.s3Client,
                new GetObjectCommand({
                    Bucket: OUTPUT_BUCKET,
                    Key: generateFilePrefix(inputFile.url) + "." + format,
                }),
                { expiresIn: 12 * 3600 }
            )
        });

        logger.info(`Begin uploading ${tempFile} to bucket '${outputFile.bucket}' with key '${outputFile.key}'`);
        await new Upload({
            client: ctx.s3Client,
            params: {
                Bucket: outputFile.bucket,
                Key: outputFile.key,
                Body: fs.createReadStream(tempFile),
                ContentType: mime.lookup(outputFile.key) || "application/octet-stream"
            }
        }).done();

        jobAssignmentHelper.jobOutput.outputFile = outputFile;

        logger.info("Marking JobAssignment as completed");
        await jobAssignmentHelper.complete();
    } finally {
        try {
            fs.rmSync(tempFile);
        } catch {
        }
    }
}
