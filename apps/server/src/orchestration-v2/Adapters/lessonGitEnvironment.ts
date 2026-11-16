export function withLessonGitNetworkBlocked(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...environment, GIT_ALLOW_PROTOCOL: "" };
}
