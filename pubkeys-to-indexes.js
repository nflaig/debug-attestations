const fs = require("fs");
const axios = require("axios");

async function fetchValidators(pubkeys) {
  const BASE_URL = "https://lodestar-mainnet.chainsafe.io";
  const state_id = "head";
  const pubkeysNoPrefix = pubkeys.map((p) => p.replace("0x", ""));
  const url = `${BASE_URL}/eth/v1/beacon/states/${state_id}/validators`;
  const response = await axios.post(url, {
    ids: pubkeysNoPrefix.map((p) => `0x${p}`),
  });

  if (response.data && response.data.data) {
    return response.data.data;
  } else {
    throw new Error("Invalid API response");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const inputFile = args[0];
  const pubkeys = fs.readFileSync(inputFile, "utf-8").trim().split("\n");

  const validatorsData = await fetchValidators(pubkeys);

  let indexesList = "";
  for (const data of validatorsData) {
    indexesList += `${data.index}\n`;
  }

  const outputFile = args[1] ?? `./data/validator_indexes.txt`;

  fs.writeFileSync(outputFile, indexesList);
  console.log(`Validator indexes saved to ${outputFile}`);
}

main().catch((error) => {
  console.error("An error occurred:", error.message, error.response?.data);
});
