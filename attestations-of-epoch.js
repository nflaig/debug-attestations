const axios = require("axios");
const fs = require("fs");
const readline = require("readline");
const path = require("path");

const MAX_REQUESTS_COUNT = 1;
const INTERVAL_MS = 1000;
const RETRY_DELAY_MS = 30000;

const api = axios.create();

// Axios request interceptor
api.interceptors.request.use(
  async function (config) {
    while (axios.pendingRequests > MAX_REQUESTS_COUNT) {
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    }

    axios.pendingRequests++;
    return config;
  },
  function (error) {
    axios.pendingRequests--;
    return Promise.reject(error);
  }
);

// Axios response interceptor
api.interceptors.response.use(
  function (response) {
    axios.pendingRequests--;
    return Promise.resolve(response);
  },
  async function (error) {
    axios.pendingRequests--;

    if (error.response.status === 429) {
      console.log("Rate limit reached. Retrying request...");
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return api(error.config);
    }

    return Promise.reject(error);
  }
);

async function fetchValidatorAttestations(validatorIndex) {
  const url = `https://beaconcha.in/api/v1/validator/${validatorIndex}/attestations`;
  try {
    const response = await api.get(url);
    return response.data;
  } catch (error) {
    console.error(`Failed to fetch validator attestations: ${error}`);
    return null;
  }
}

async function checkAttestationsForIndex(validatorIndex, epoch) {
  console.log(`Processing validator index: ${validatorIndex}`);
  const attestationsData = await fetchValidatorAttestations(validatorIndex);
  if (!attestationsData) {
    // Fetching validator attestations failed
    return null;
  }

  return attestationsData.data.filter((a) => a.epoch === epoch && a.status === 1);
}

async function processValidatorIndexesFile() {
  const args = process.argv.slice(2);
  const filename = args[0];
  const epoch = Number(args[1]);
  const fileStream = fs.createReadStream(filename);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const outputDirectory = `./data/attestations-epoch-${epoch}`;
  fs.mkdirSync(outputDirectory, { recursive: true });

  const totalAttestations = [];

  for await (const line of rl) {
    const validatorIndex = line.trim();
    if (!validatorIndex) {
      continue;
    }
    const attestations = await checkAttestationsForIndex(validatorIndex, epoch);
    if (!attestations) {
      continue;
    }
    totalAttestations.push(...attestations);
  }

  const attestationsFilePath = path.join(outputDirectory, "attestations.json");
  fs.writeFileSync(attestationsFilePath, JSON.stringify(totalAttestations, null, 2));

  console.log(`Process finished. Check the "${outputDirectory}" directory for results`);
}

processValidatorIndexesFile();
