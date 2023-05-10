import * as ffmpeg from "fluent-ffmpeg";
import * as stream from "stream";
import * as mime from "mime-types";
import { S3Client, GetObjectCommand, CompleteMultipartUploadCommandOutput, AbortMultipartUploadCommandOutput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";

import { McmaException, TransformJob } from "@mcma/core";
import { ProcessJobAssignmentHelper, ProviderCollection } from "@mcma/worker";
import { S3Locator } from "@mcma/aws-s3";
import { generateFilePrefix } from "./utils";

const { OUTPUT_BUCKET } = process.env;

async function ffmpegExtractThumbnail(params: { [key: string]: any }, inputFile: S3Locator, outputFile: S3Locator, s3Client: S3Client) {
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

export async function extractThumbnail(providers: ProviderCollection, jobAssignmentHelper: ProcessJobAssignmentHelper<TransformJob>, ctx: { s3Client: S3Client }) {
    const logger = jobAssignmentHelper.logger;
    const jobInput = jobAssignmentHelper.jobInput;

    logger.info("Execute ffmpeg on input file");
    let inputFile = jobInput.inputFile as S3Locator;

    if (!inputFile.url) {
        throw new McmaException("Not able to obtain input file");
    }

    const outputFile = new S3Locator({
        url: await getSignedUrl(
            ctx.s3Client,
            new GetObjectCommand({
                Bucket: OUTPUT_BUCKET,
                Key: generateFilePrefix(inputFile.url) + ".jpg",
            }),
            { expiresIn: 12 * 3600 }
        )
    });

    const data = await ffmpegExtractThumbnail(jobInput, inputFile, outputFile, ctx.s3Client);
    logger.info(data);

    jobAssignmentHelper.jobOutput.outputFile = outputFile;

    logger.info("Marking JobAssignment as completed");
    await jobAssignmentHelper.complete();
}
