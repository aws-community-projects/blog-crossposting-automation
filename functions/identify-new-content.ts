import { Octokit } from "octokit";
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { getSecret } from "./utils/secrets";

const sfn = new SFNClient({});
let octokit: Octokit;

export const handler = async (event: any) => {
  try {
    await initializeOctokit();

    const recentCommits = await getRecentCommits();
    if (recentCommits.length) {
      const newContent = await getNewContent(recentCommits);
      if (newContent.length) {
        const data = await getContentData(newContent);
        await processNewContent(data);
      }
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

    const blogPath = process.env.BLOG_PATH && process.env.BLOG_PATH !== "/";
    const newFiles = commitDetail.data.files?.filter(
      (f) =>
        f.status == "added" && (!blogPath || f.filename.startsWith(`${process.env.BLOG_PATH}/`))
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
  // TODO: regex for images stored in github and fetch them / store them in a public s3 bucket
}

const processNewContent = async (
  newContent: {
    fileName: string;
    commit: string;
    content: string;
    sendStatusEmail: boolean;
  }[]
) => {
  const executions = await Promise.allSettled(newContent.map(async (content) => {
    const command = new StartExecutionCommand({
      stateMachineArn: process.env.STATE_MACHINE_ARN,
      input: JSON.stringify(content)
    });
    await sfn.send(command);
  }));

  for (const execution of executions) {
    if (execution.status == 'rejected') {
      console.error(execution.reason);
    }
  }
};
