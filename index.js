const axios = require("axios");
const Slack = require("slack-node");
const fs = require("fs").promises;

require("dotenv").config();

const fetchDataFromGetro = async (networkId, email, token) => {
  // Filter software dev roles
  const url = (pageNumber) =>
    `https://api.getro.com/v2/networks/${networkId}/jobs?page=${pageNumber}&per_page=100&job_functions=Software Engineering`;

  try {
    const headers = {
      headers: {
        "X-User-Email": email,
        "X-User-Token": token,
        "Accept-Encoding": "application/json",
      },
    };

    let res = await axios.get(url(1), headers);
    let totalPages = Math.ceil(res.data.meta.total / 100);
    // const db = admin.firestore();
    let dataArray = [];
    for (let i = 1; i <= totalPages; i++) {
      try {
        let res = await axios.get(url(i), headers);
        res.data.items.map((item) => {
          dataArray.push({
            id: item.id,
            title: item.title,
            url: item.url,
            company: item.company.name,
          });
        });
      } catch (e) {
        console.error("error", e);
      }
    }
    return dataArray;
  } catch (error) {
    console.error("TBDT getro res error", error);
  }
};

// get extant job ids from file and return an array of numbers
const getOldJobs = async (fileName) => {
  try {
    const oldFile = await fs.readFile(fileName);
    const arrayOfOldIds = oldFile.toString().split(",");
    return JSON.parse(arrayOfOldIds);
  } catch (error) {
    console.error("No old file detected or empty file");
    return [];
  }
};

const deleteOldFile = async (fileName) => {
  try {
    await fs.unlink(fileName);
  } catch (err) {
    if (err) console.error(err); // will only throw an error on first run when file doesn't exist
  }
};
const storeJobs = async (fileName, jobs) => {
  console.log("TBDT storing jobs");
  try {
    await fs.writeFile(fileName, JSON.stringify(jobs));
    console.log("The file was saved!");
  } catch (err) {
    if (err) {
      console.error("ERROR storing jobs", err);
      return console.log(err);
    }
  }
};

const getNewJobs = (newJobs, oldJobs) => {
  return newJobs.filter((newJob) => {
    return oldJobs.findIndex((oldJob) => oldJob.id === newJob.id) === -1;
  });
};

const getDeletedJobs = (oldJobs, newJobs) => {
  return oldJobs.filter((oldJob) => {
    return newJobs.findIndex((newJob) => newJob.id === oldJob.id) === -1;
  });
};

const sendNotification = (messageToBeSent) => {
  const notificationWebHookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!notificationWebHookUrl) throw new Error("Missing slack webhook URL");
  // Slack Notification
  const slack = new Slack();
  slack.setWebhook(notificationWebHookUrl);
  slack.webhook(
    {
      channel: "getro-api",
      username: "Commit Getro Bot",
      text: messageToBeSent,
    },
    function (err, _response) {
      if (err) console.error(err);
    }
  );
};

const getJobsDelta = async (apiCreds, oldFileName) => {
  const { networkId, email, token } = apiCreds;
  // get all jobs from getro
  const jobsOnGetro = await fetchDataFromGetro(networkId, email, token);

  // get all jobs from past run
  const extantJobs = await getOldJobs(oldFileName);

  // NEW JOBS - get all jobs that exist in past list of jobs (artefact)
  const newJobs = getNewJobs(jobsOnGetro, extantJobs);

  // DELETED JOBS  get all jobs that in past list of jobs that are not in the current getro response
  const deletedJobs = getDeletedJobs(extantJobs, jobsOnGetro);

  return { newJobs, deletedJobs, jobsOnGetro };
};

const sendJobNotifications = async (jobs, isNew, isFarming, apiCreds) => {
  if (jobs.length > 0) {
    jobs.map(async (job) => {
      // only send notification where we were able to get the details
      sendNotification(
        `A job has been ${isNew ? "added" : "removed"} by ${
          job.company
        } on the ${isFarming ? "farming" : "hunting"} board\nId: ${
          job.id
        }\nTitle: ${job.title}\nLink: ${job.url}`
      );
    });
  }
};

const main = async () => {
  const farmingNetworkId = process.env.GETRO_API_FARMING_NETWORK_ID;
  const huntingNetworkId = process.env.GETRO_API_HUNTING_NETWORK_ID;
  const email = process.env.GETRO_API_EMAIL;
  const token = process.env.GETRO_API_TOKEN;
  const farmingFile = "./farmingGetro.txt";
  const huntingFile = "./huntingGetro.txt";

  if (!email || !token) throw new Error("Missing api email and token env vars");
  if (!farmingNetworkId || !huntingNetworkId)
    throw new Error("Missing network ID env vars");

  const apiCredsFarming = { networkId: farmingNetworkId, email, token };
  const apiCredsHunting = { networkId: farmingNetworkId, email, token };

  // get the change in jobs from old artefact to current getro response
  const {
    newJobs: newFarmingJobs,
    deletedJobs: deletedFarmingJobs,
    jobsOnGetro: farmingJobsOnGetro,
  } = await getJobsDelta(apiCredsFarming, farmingFile);
  const {
    newJobs: newHuntingJobs,
    deletedJobs: deletedHuntingJobs,
    jobsOnGetro: huntingJobsOnGetro,
  } = await getJobsDelta(apiCredsHunting, huntingFile);

  console.log(
    "TBDT got new jobs FARMING",
    newFarmingJobs,
    "TBDT got deleted jobs FARMING",
    deletedFarmingJobs
  );
  console.log(
    "TBDT got new jobs HUNTING",
    newHuntingJobs,
    "got deleted jobs HUNTING",
    deletedHuntingJobs
  );

  // Send a slack notification for each of the NEW JOBS and DELETED JOBS
  sendJobNotifications(newFarmingJobs, true, true, apiCredsFarming);
  sendJobNotifications(deletedFarmingJobs, false, true, apiCredsFarming);
  sendJobNotifications(newHuntingJobs, true, false, apiCredsHunting);
  sendJobNotifications(deletedHuntingJobs, false, false, apiCredsHunting);

  // delete old file if it exists
  await deleteOldFile(farmingFile);
  await deleteOldFile(huntingFile);

  // update artefact store for job ids
  storeJobs(farmingFile, farmingJobsOnGetro);
  storeJobs(huntingFile, huntingJobsOnGetro);
  return;
};

main();
