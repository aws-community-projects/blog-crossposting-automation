export const getLinks = (postContent: string) => {
  const linkMatches = postContent.matchAll(/\(([^\)]*)\)/g);
  return linkMatches;
};