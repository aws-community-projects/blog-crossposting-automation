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

  const payload = formatDevData(details, state.articleCatalog, links, tweets);
  return {
    payload,
    url: `/${details.data.slug.replace(/^\/|\/$/g, "")}`,
  };
};

const formatDevData = (
  postDetail: {
    content: string;
    data: {
      title: any;
      image: any;
      slug: string;
      description: any;
      categories: any[];
      tags: any[];
    };
  },
  articleCatalog: any[],
  links: any,
  tweets: any
) => {
  let devContent = postDetail.content.slice(0);
  for (const link of links) {
    const replacement = articleCatalog.find((c) => c.links.M.url.S == link[1]);
    if (replacement) {
      if (replacement.links.M.devUrl && replacement.links.M.devUrl.S) {
        devContent = devContent.replace(link[1], replacement.links.M.devUrl.S);
      } else {
        devContent = devContent.replace(
          link[1],
          `${process.env.AMPLIFY_BASE_URL}${replacement.links.M.url.S}`
        );
      }
    }
  }

  for (const tweet of tweets) {
    const tweetUrl = getTweetUrl(tweet);
    devContent = devContent.replace(tweet[0], `{% twitter ${tweetUrl} %}`);
  }

  const devData = {
    title: postDetail.data.title,
    published: true,
    main_image: postDetail.data.image,
    ...(process.env.CANONICAL === "dev" ? {} : {
      canonical_url: process.env.AMPLIFY_BASE_URL ? `${process.env.AMPLIFY_BASE_URL}/${postDetail.data.slug.replace(
        /^\/|\/$/g,
        ""
      )}` : ``,
    }),
    description: postDetail.data.description,
    tags: [
      ...postDetail.data.categories.map((c) => c.replace(/ /g, "")),
      ...postDetail.data.tags.map((t) => t.toString().replace(/ /g, "")),
    ],
    ...(process.env.DEV_ORG_ID && { organization_id: process.env.DEV_ORG_ID }),
    body_markdown: devContent,
  };

  return { article: devData };
};
