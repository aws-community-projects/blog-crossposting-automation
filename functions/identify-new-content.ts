import { Octokit } from "octokit";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { getSecret } from "./utils/secrets";

const eb = new EventBridgeClient({});

let octokit: Octokit;

export const handler = async () => {
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
    path: process.env.PATH,
    since: date.toISOString(),
  });

  const newPostCommits = result.data.filter((c) =>
    c.commit.message
      .toLowerCase()
      .startsWith(`${process.env.NEW_CONTENT_INDICATOR || '[blog]'}`)
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
        f.status == "added" && f.filename.startsWith(`${process.env.PATH}/`)
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

const processNewContent = async (
  newContent: {
    fileName: string;
    commit: string;
    content: string;
    sendStatusEmail: boolean;
  }[]
) => {
  const Entries = newContent.map((content) => ({
    Source: `cross-post`,
    DetailType: "process-new-content",
    Detail: JSON.stringify(content),
  }));

  const putEventsCommand = new PutEventsCommand({
    Entries,
  });
  await eb.send(putEventsCommand);
};
