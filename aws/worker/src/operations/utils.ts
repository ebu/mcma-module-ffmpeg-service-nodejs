const { OutputBucketPrefix } = process.env;

export function generateFilePrefix(url: string) {
    let filename = decodeURIComponent(new URL(url).pathname);
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
