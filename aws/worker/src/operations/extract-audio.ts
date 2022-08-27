import { ProcessJobAssignmentHelper, ProviderCollection } from "@mcma/worker";
import { Locator, McmaException, TransformJob } from "@mcma/core";
import { S3 } from "aws-sdk";
import { S3Locator } from "@mcma/aws-s3";
import { generateFilePrefix } from "./utils";
import * as stream from "stream";
import * as mime from "mime-types";
import * as ffmpeg from "fluent-ffmpeg";

const { OutputBucket } = process.env;

async function ffmpegExtractAudio(params: { [key: string]: any }, inputFile: Locator, outputFile: S3Locator, s3: S3) {
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
            .setFfmpegPath("/opt/ffmpeg");

        if (params.audioCodec) {
            pipeline.audioCodec(params.audioCodec);
        }

        pipeline.outputFormat(params.outputFormat)
            .output(writableStream)
            .on("error", function (err, stdout, stderr) {
                reject(err);
            })
            .run();
    }));
}

export async function extractAudio(providers: ProviderCollection, jobAssignmentHelper: ProcessJobAssignmentHelper<TransformJob>, ctx: { s3: S3 }) {
    const logger = jobAssignmentHelper.logger;
    const jobInput = jobAssignmentHelper.jobInput;

    logger.info("Execute ffmpeg on input file");
    const inputFile = jobInput.inputFile as S3Locator;

    jobInput.outputFormat = jobInput.outputFormat as string ?? "flac";

    if (!inputFile.url) {
        throw new McmaException("Not able to obtain input file");
    }

    const outputFile = new S3Locator({
        url: ctx.s3.getSignedUrl("getObject", {
            Bucket: OutputBucket,
            Key: generateFilePrefix(inputFile.url) + "." + jobInput.outputFormat,
            Expires: 12 * 3600
        })
    });

    const data = await ffmpegExtractAudio(jobInput, inputFile, outputFile, ctx.s3);
    logger.info(data);

    jobAssignmentHelper.jobOutput.outputFile = outputFile;

    logger.info("Marking JobAssignment as completed");
    await jobAssignmentHelper.complete();
}
