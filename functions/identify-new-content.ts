import { Octokit } from "octokit";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { getSecret } from "./utils/secrets";
import { join } from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const sfn = new SFNClient({});
const s3 = new S3Client({});
const blogPathDefined = !!(
  process.env.BLOG_PATH && process.env.BLOG_PATH !== "/"
);
let octokit: Octokit;

export const handler = async (event: any) => {
  try {
    await initializeOctokit();

    let newContent: { fileName: string; commit: string }[] = [];
    if (event.body) {
      const body = JSON.parse(event.body);
      console.log(JSON.stringify({ body }, null, 2));
      if (body.commits) {
        newContent = body.commits.reduce(
          (
            p: { fileName: string; commit: string }[],
            commit: {
              id: string;
              added: string[];
              modified: string[];
              // ... there's more stuff here, but this is all we need
            }
          ) => {
            const addedFiles = commit.added.filter(
              (addedFile: string) =>
                (!blogPathDefined ||
                  addedFile.startsWith(`${process.env.BLOG_PATH}/`)) &&
                addedFile.endsWith(".md")
            );
            return [
              ...p,
              ...addedFiles.map((addedFile) => ({
                fileName: addedFile,
                commit: commit.id,
              })),
            ];
          },
          [] as { fileName: string; commit: string }[]
        );
      } else {
        const recentCommits = await getRecentCommits();
        if (recentCommits.length) {
          newContent = await getNewContent(recentCommits);
        }
      }
    }
    if (newContent.length) {
      const data = await getContentData(newContent);
      const imagesProcessed = await saveImagesToS3(data);
      await processNewContent(imagesProcessed);
    }
  } catch (err) {
    console.error(err);
  }
};

const initializeOctokit = async () => {
  if (!octokit) {
    const gitHubSecret = await getSecret("github");
    octokit = new Octokit({ auth: gitHubSecret });
  }
};

const getRecentCommits = async () => {
  const timeTolerance = Number(process.env.COMMIT_TIME_TOLERANCE_MINUTES || 10);
  const date = new Date();
  date.setMinutes(date.getMinutes() - timeTolerance);

  const result = await octokit.rest.repos.listCommits({
    owner: `${process.env.OWNER}`,
    repo: `${process.env.REPO}`,
    ...(process.env.BLOG_PATH && process.env.BLOG_PATH !== "/"
      ? { path: `${process.env.BLOG_PATH}` }
      : {}),
    since: date.toISOString(),
  });

  const newPostCommits = result.data.filter((c) =>
    c.commit.message
      .toLowerCase()
      .startsWith(`${process.env.NEW_CONTENT_INDICATOR || "[blog]"}`)
  );
  return newPostCommits.map((d) => d.sha);
};

const getNewContent = async (commits: string[]) => {
  const newContent: { fileName: string; commit: string }[] = [];
  for (let j = 0; j < commits.length; j++) {
    const commitDetail = await octokit.rest.repos.getCommit({
      owner: `${process.env.OWNER}`,
      repo: `${process.env.REPO}`,
      ref: commits[j],
    });

    const newFiles = commitDetail.data.files?.filter(
      (f) =>
        f.status == "added" &&
        (!blogPathDefined ||
          f.filename.startsWith(`${process.env.BLOG_PATH}/`)) &&
        f.filename.endsWith(".md")
    );
    newContent.push(
      ...(newFiles?.map((p) => {
        return {
          fileName: p.filename,
          commit: commits[j],
        };
      }) || [])
    );
  }

  return newContent;
};

const getContentData = async (
  newContent: { fileName: string; commit: string }[]
) => {
  const contentData: {
    fileName: string;
    commit: string;
    content: string;
    sendStatusEmail: boolean;
  }[] = [];
  for (let j = 0; j < newContent.length; j++) {
    const content = newContent[j];
    const postContent = await octokit.request(
      "GET /repos/{owner}/{repo}/contents/{path}",
      {
        owner: `${process.env.OWNER}`,
        repo: `${process.env.REPO}`,
        path: content.fileName,
      }
    );

    const buffer = Buffer.from((postContent.data as any).content, "base64");
    const data = buffer.toString("utf8");

    contentData.push({
      fileName: content.fileName,
      commit: content.commit,
      content: data,
      sendStatusEmail: process.env.SEND_STATUS_EMAIL == "true",
    });
  }

  return contentData;
};

const saveImagesToS3 = async (
  newContent: {
    fileName: string;
    commit: string;
    content: string;
    sendStatusEmail: boolean;
  }[]
) => {
  const contentData: {
    fileName: string;
    commit: string;
    content: string;
    sendStatusEmail: boolean;
  }[] = [];
  const imgRegex = /!\[(.*?)\]\((.*?)\)/g;
  for (let j = 0; j < newContent.length; j++) {
    const workingContent = { ...newContent[j] };
    const imageSet = new Set<string>([]);
    let match;
    while ((match = imgRegex.exec(newContent[j].content)) !== null) {
      imageSet.add(match[2]);
    }
    const images = [...imageSet];
    if (images.length === 0) {
      // no images in the post... passthrough
      contentData.push(newContent[j]);
      continue;
    }
    const blogFile = newContent[j].fileName;
    const blogSplit = `${blogFile}`.split("/");
    blogSplit.pop();
    const blogBase = blogSplit.join("/");
    const s3Mapping: Record<string, string> = {};
    for (let k = 0; k < images.length; k++) {
      const image = images[k];
      const githubPath = join(blogBase, image);
      const imageSplit = image.split(".");
      const imageExtension = imageSplit[imageSplit.length - 1];
      const s3Path = `${blogFile}/${k}.${imageExtension}`.replace(/\ /g, "-");
      const s3Url = `https://s3.amazonaws.com/${process.env.MEDIA_BUCKET}/${s3Path}`;
      console.log(
        JSON.stringify({ image, githubPath, s3Path, s3Url }, null, 2)
      );
      const postContent = await octokit.request(
        "GET /repos/{owner}/{repo}/contents/{path}",
        {
          owner: `${process.env.OWNER}`,
          repo: `${process.env.REPO}`,
          path: githubPath,
        }
      );

      const buffer = Buffer.from((postContent.data as any).content, "base64");

      // upload images to s3
      const putImage = new PutObjectCommand({
        Bucket: `${process.env.MEDIA_BUCKET}`,
        Key: s3Path,
        Body: buffer,
      });
      await s3.send(putImage);

      s3Mapping[image] = s3Url;
    }
    const rewriteLink = (match: string, text: string, url: string) => {
      console.log(JSON.stringify({ match, text, url }));
      return `![${text}](${s3Mapping[url]})`;
    }
    workingContent.content = workingContent.content.replace(imgRegex, rewriteLink);
    contentData.push(workingContent);
  }
  console.log(JSON.stringify({ contentData }));
  return contentData;
};

const processNewContent = async (
  newContent: {
    fileName: string;
    commit: string;
    content: string;
    sendStatusEmail: boolean;
  }[]
) => {
  const executions = await Promise.allSettled(
    newContent.map(async (content) => {
      const command = new StartExecutionCommand({
        stateMachineArn: process.env.STATE_MACHINE_ARN,
        input: JSON.stringify(content),
      });
      await sfn.send(command);
    })
  );

  for (const execution of executions) {
    if (execution.status == "rejected") {
      console.error(execution.reason);
    }
  }
};
