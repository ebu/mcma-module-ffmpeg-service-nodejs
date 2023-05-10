import { ProcessJobAssignmentHelper, ProviderCollection } from "@mcma/worker";
import { Locator, McmaException, TransformJob } from "@mcma/core";
import { AbortMultipartUploadCommandOutput, CompleteMultipartUploadCommandOutput, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { S3Locator } from "@mcma/aws-s3";
import { generateFilePrefix } from "./utils";
import * as stream from "stream";
import * as mime from "mime-types";
import * as ffmpeg from "fluent-ffmpeg";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const { OUTPUT_BUCKET } = process.env;

async function ffmpegExtractAudio(params: { [key: string]: any }, inputFile: Locator, outputFile: S3Locator, s3Client: S3Client) {
    return new Promise<AbortMultipartUploadCommandOutput | CompleteMultipartUploadCommandOutput>(((resolve, reject) => {
        const writableStream = new stream.PassThrough();

        new Upload({
            client: s3Client,
            params: {
                Bucket: outputFile.bucket,
                Key: outputFile.key,
                Body: writableStream,
                ContentType: mime.lookup(outputFile.key) || "application/octet-stream"
            }
        }).done().then(r => resolve(r)).catch(e => reject(e));

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

export async function extractAudio(providers: ProviderCollection, jobAssignmentHelper: ProcessJobAssignmentHelper<TransformJob>, ctx: { s3Client: S3Client }) {
    const logger = jobAssignmentHelper.logger;
    const jobInput = jobAssignmentHelper.jobInput;

    logger.info("Execute ffmpeg on input file");
    const inputFile = jobInput.inputFile as S3Locator;

    jobInput.outputFormat = jobInput.outputFormat as string ?? "flac";

    if (!inputFile.url) {
        throw new McmaException("Not able to obtain input file");
    }

    const outputFile = new S3Locator({
        url: await getSignedUrl(
            ctx.s3Client,
            new GetObjectCommand({
                Bucket: OUTPUT_BUCKET,
                Key: generateFilePrefix(inputFile.url) + "." + jobInput.outputFormat,
            }),
            { expiresIn: 12 * 3600 }
        )
    });

    const data = await ffmpegExtractAudio(jobInput, inputFile, outputFile, ctx.s3Client);
    logger.info(data);

    jobAssignmentHelper.jobOutput.outputFile = outputFile;

    logger.info("Marking JobAssignment as completed");
    await jobAssignmentHelper.complete();
}
