const runtimeVariables = new Set([
  "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TZ",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "STUDIO_DATA",
]);

export function serverEnvironment(environment, local) {
  return local ? environment : Object.fromEntries(
    Object.entries(environment).filter(([name]) => runtimeVariables.has(name)),
  );
}

export function serverArguments(server, local) {
  return local ? ["--env-file-if-exists=.env", server] : [server];
}
