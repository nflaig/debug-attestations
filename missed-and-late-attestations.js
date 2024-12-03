const axios = require("axios");
const fs = require("fs");
const readline = require("readline");
const path = require("path");

const MAX_REQUESTS_COUNT = 1;
const INTERVAL_MS = 1000;
const RETRY_DELAY_MS = 30000;

// Attestations with inclusion delay >= this value are considered late
const LATE_ATT_INCLUSION_DELAY = 1;

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
    console.error(`Failed to fetch validator attestations: ${error}`, error.response?.data);
    return null;
  }
}

async function fetchSlotDetails(slot) {
  const url = `https://beaconcha.in/api/v1/slot/${slot}`;
  try {
    const response = await api.get(url);
    return response.data;
  } catch (error) {
    console.error(`Failed to fetch slot ${slot} details: ${error}`, error.response?.data);
    return { status: "ERROR: could not retrieve db results" };
  }
}

async function checkAttestationsForIndex(validatorIndex) {
  console.log(`Processing validator index: ${validatorIndex}`);
  const attestationsData = await fetchValidatorAttestations(validatorIndex);
  if (!attestationsData) {
    // Fetching validator attestations failed
    return null;
  }

  let lateAttestations = [];
  let missedAttestations = [];
  let attestationCount = attestationsData.data.length;

  const pendingEpoch = Math.max(...attestationsData.data.map((attestation) => attestation.epoch));

  for (let attestation of attestationsData.data) {
    if (attestation.status === 0 && attestation.epoch !== pendingEpoch) {
      const slotDetails = await fetchSlotDetails(attestation.attesterslot + 1);
      const blockMissed = slotDetails.status === "ERROR: could not retrieve db results";
      missedAttestations.push({ ...attestation, blockMissed });
    } else if (attestation.inclusionslot - attestation.attesterslot - 1 >= LATE_ATT_INCLUSION_DELAY) {
      const slotDetails = await fetchSlotDetails(attestation.attesterslot + 1);
      const blockMissed = slotDetails.status === "ERROR: could not retrieve db results";
      if (blockMissed) {
        // subtract the missed slot from inclusion delay as it can not be included without a block
        const optimalInclusionDelay = attestation.inclusionslot - attestation.attesterslot - 2;

        if (optimalInclusionDelay >= LATE_ATT_INCLUSION_DELAY) {
          lateAttestations.push({ ...attestation, blockMissed });
        }
      } else {
        lateAttestations.push({ ...attestation, blockMissed });
      }
    }
  }

  return { attestationCount, missedAttestations, lateAttestations };
}

async function processValidatorIndexesFile() {
  const args = process.argv.slice(2);
  const filename = args[0];
  const fileStream = fs.createReadStream(filename);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const currentDate = new Date().toISOString().replace(/:/g, "-").split(".")[0];
  const outputDirectory = `./data/${currentDate}`;
  fs.mkdirSync(outputDirectory, { recursive: true });

  let totalLateAttestations = [];
  let totalMissedAttestations = [];
  let totalAttestations = 0;
  let totalLateWithMissedBlock = 0;
  let totalMissedWithMissedBlock = 0;

  for await (const line of rl) {
    const validatorIndex = line.trim();
    if (!validatorIndex) {
      continue;
    }
    const attestationData = await checkAttestationsForIndex(validatorIndex);
    if (!attestationData) {
      continue;
    }

    const { attestationCount, missedAttestations, lateAttestations } = attestationData;

    totalAttestations += attestationCount;
    totalMissedAttestations = totalMissedAttestations.concat(missedAttestations);
    totalLateAttestations = totalLateAttestations.concat(lateAttestations);

    for (const attestation of lateAttestations) {
      if (attestation.blockMissed) {
        totalLateWithMissedBlock++;
      }
    }

    for (const attestation of missedAttestations) {
      if (attestation.blockMissed) {
        totalMissedWithMissedBlock++;
      }
    }
  }

  const lateAttestationsFilePath = path.join(outputDirectory, "late_attestations.json");
  fs.writeFileSync(lateAttestationsFilePath, JSON.stringify(totalLateAttestations, null, 2));

  const missedAttestationsFilePath = path.join(outputDirectory, "missed_attestations.json");
  fs.writeFileSync(missedAttestationsFilePath, JSON.stringify(totalMissedAttestations, null, 2));

  const summaryFilePath = path.join(outputDirectory, "summary.md");
  const summaryContent = createSummaryMarkdown(
    totalAttestations,
    totalMissedAttestations,
    totalLateAttestations,
    totalLateWithMissedBlock,
    totalMissedWithMissedBlock
  );
  fs.writeFileSync(summaryFilePath, summaryContent);

  console.log(`Process finished. Check the "${outputDirectory}" directory for results`);
}

function createSummaryMarkdown(
  totalAttestations,
  totalMissedAttestations,
  totalLateAttestations,
  totalLateWithMissedBlock,
  totalMissedWithMissedBlock
) {
  const missedPercentage = calculatePercentage(totalMissedAttestations.length, totalAttestations);
  const latePercentage = calculatePercentage(totalLateAttestations.length, totalAttestations);
  const lateWithMissedBlockPercentage = calculatePercentage(totalLateWithMissedBlock, totalAttestations);
  const missedWithMissedBlockPercentage = calculatePercentage(totalMissedWithMissedBlock, totalAttestations);

  let mdData = `# Summary\n\n`;
  mdData += "Missed and late attestations during last 100 epochs\n\n";
  mdData += `| Metric                                        | Count | Percentage |\n`;
  mdData += `| --------------------------------------------- | ----- | ---------- |\n`;
  mdData += `| Total Attestations                            | ${totalAttestations}              | 100%       |\n`;
  mdData += `| Missed Attestations Total                     | ${totalMissedAttestations.length} | ${missedPercentage}%   |\n`;
  mdData += `| Missed Attestations with Missed Block (N + 1) | ${totalMissedWithMissedBlock}     | ${missedWithMissedBlockPercentage}%   |\n`;
  mdData += `| Late Attestations Total (incl. delay >= ${LATE_ATT_INCLUSION_DELAY})    | ${totalLateAttestations.length}   | ${latePercentage}%   |\n`;
  mdData += `| Late Attestations with Missed Block (N + 1)   | ${totalLateWithMissedBlock}       | ${lateWithMissedBlockPercentage}%   |\n`;

  mdData += `\n## Missed Attestations\n\n`;
  mdData += createMarkdownTable(totalMissedAttestations);

  mdData += `\n## Late Attestations\n\n`;
  mdData += createMarkdownTable(totalLateAttestations);

  return mdData;
}

function createMarkdownTable(attestations) {
  let mdData = "| Validator Index | Attester Slot | Inclusion Slot | Block Missed (N + 1) |\n";
  mdData += "| --------------- | ------------- | -------------- | --------------------- |\n";

  for (const attestation of attestations) {
    const inclusionSlot = attestation.inclusionslot !== 0 ? attestation.inclusionslot : null;
    const inclusionSlotWithDelay = inclusionSlot
      ? `${inclusionSlot} (${inclusionSlot - attestation.attesterslot - 1})`
      : "null";
    mdData += `| ${attestation.validatorindex} | ${attestation.attesterslot} | ${inclusionSlotWithDelay} | ${attestation.blockMissed} |\n`;
  }

  if (attestations.length === 0) {
    mdData += "| - | - | - | - |\n";
  }

  return mdData;
}

function calculatePercentage(numerator, denominator) {
  const percentage = (numerator / denominator) * 100;
  return isNaN(percentage) ? "0.00" : percentage.toFixed(2);
}

processValidatorIndexesFile();
