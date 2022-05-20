import * as ffmpeg from "fluent-ffmpeg";
import * as stream from "stream";
import { S3 } from "aws-sdk";

import { McmaException, TransformJob, Utils } from "@mcma/core";
import { ProcessJobAssignmentHelper, ProviderCollection } from "@mcma/worker";
import { S3Locator, S3LocatorProperties } from "@mcma/aws-s3";

const { OutputBucket, OutputBucketPrefix } = process.env;

export function generateFilePrefix(url: string) {
    let filename = Utils.parseUrl(url).pathname;
    let pos = filename.lastIndexOf("/");
    if (pos >= 0) {
        filename = filename.substring(pos + 1);
    }
    pos = filename.lastIndexOf(".");
    if (pos >= 0) {
        filename = filename.substring(0, pos);
    }

    return `${OutputBucketPrefix}${new Date().toISOString().substring(0, 19).replace(/[:]/g, "-")}/${filename}`;
}

async function ffmpegExtractThumbnail(inputFile: S3LocatorProperties, outputFile: S3LocatorProperties, contentType: string, s3: S3) {
    return new Promise<S3.ManagedUpload.SendData>(((resolve, reject) => {

    const writableStream = new stream.PassThrough();

    s3.upload({
        Bucket: outputFile.bucket,
        Key: outputFile.key,
        Body: writableStream,
        ContentType: contentType
    }, function (err: Error, data: S3.ManagedUpload.SendData) {
        if (err) {
            return reject(err);
        }
        return resolve(data);
    });

    ffmpeg(inputFile.url)
        .setFfmpegPath("/opt/ffmpeg")
        .seekInput(1)
        .frames(1)
        .size("320x?")
        .aspect("16:9")
        .autopad()
        .outputFormat("mjpeg")
        .output(writableStream)
        .on('error', function(err, stdout, stderr) {
            reject(err);
        })
        .run();
    }))
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

    const data = await ffmpegExtractThumbnail(inputFile, outputFile, "image/jpeg", ctx.s3);
    logger.info(data);

    jobAssignmentHelper.jobOutput.set("outputFile", outputFile);

    logger.info("Marking JobAssignment as completed");
    await jobAssignmentHelper.complete();
}
