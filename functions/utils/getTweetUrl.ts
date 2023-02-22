export const getTweetUrl = (tweet: string[]) => {
  return `https://twitter.com/${tweet[1]}/status/${tweet[2]}`;
};