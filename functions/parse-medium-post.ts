import { getLinks } from "./utils/getLinks";
import { getTweets } from "./utils/getTweets";
import { getTweetUrl } from "./utils/getTweetUrl";

const frontmatter = require("@github-docs/frontmatter");

export const handler = async (state: {
  post: any;
  format: string;
  articleCatalog: any;
  canonical?: string;
}) => {
  const details = frontmatter(state.post);
  const links = getLinks(details.content);
  const tweets = getTweets(details.content);

  const payload = formatMediumData(
    details,
    state.articleCatalog,
    links,
    tweets
  );

  return {
    payload,
    url: `/${details.data.slug.replace(/^\/|\/$/g, "")}`,
  };
};

const formatMediumData = (
  postDetail: {
    data: {
      title: any;
      description: any;
      image_attribution: any;
      image: any;
      categories: any;
      tags: any;
      slug: string;
    };
    content: string | any[];
  },
  articleCatalog: any[],
  links: any,
  tweets: any
) => {
  let mediumContent =
    `\n# ${postDetail.data.title}\n` +
    `#### ${postDetail.data.description}\n` +
    `![${postDetail.data.image_attribution ?? ""}](${
      postDetail.data.image
    })\n` +
    `${postDetail.content.slice(0)}`;

  for (const link of links) {
    const replacement = articleCatalog.find((c) => c.links.M.url.S == link[1]);
    if (replacement) {
      if (replacement.links.M.mediumUrl && replacement.links.M.mediumUrl.S) {
        mediumContent = mediumContent.replace(
          link[1],
          replacement.links.M.mediumUrl.S
        );
      } else {
        mediumContent = mediumContent.replace(
          link[1],
          `${process.env.AMPLIFY_BASE_URL}${replacement.links.M.url.S}`
        );
      }
    }
  }

  for (const tweet of tweets) {
    const tweetUrl = getTweetUrl(tweet);
    mediumContent = mediumContent.replace(tweet[0], tweetUrl);
  }

  const mediumData = {
    title: postDetail.data.title,
    contentFormat: "markdown",
    tags: [...postDetail.data.categories, ...postDetail.data.tags],
    ...(process.env.CANONICAL === "medium"
      ? {}
      : {
          canonical_url: process.env.AMPLIFY_BASE_URL
            ? `${process.env.AMPLIFY_BASE_URL}/${postDetail.data.slug.replace(
                /^\/|\/$/g,
                ""
              )}`
            : `${process.env.CANONICAL}`,
        }),
    publishStatus: "draft",
    notifyFollowers: true,
    content: mediumContent,
  };

  return mediumData;
};
