const healthcheckTarget = process.env.PORT ?? process.env.INTEGRATION_SERVICE_PORT ?? '3001';

await fetch(`http://127.0.0.1:${healthcheckTarget}/health`)
  .then((response) => {
    if (!response.ok) {
      throw new Error(`Healthcheck failed with status ${response.status}`);
    }
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
