import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";
import fetch from 'cross-fetch'; // Using cross-fetch for compatibility

async function broadcastState(N: number, nodeId: number, nodeState: NodeState): Promise<void> {
  const promises = [];
  for (let i = 0; i < N; i++) {
    if (i !== nodeId) { // Avoid sending message to self
      const url = `http://localhost:${BASE_NODE_PORT + i}/message`;
      promises.push(fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderId: nodeId, ...nodeState }),
      }));
    }
  }
  await Promise.all(promises);
}

export async function node(
  nodeId: number,
  N: number,
  F: number,
  initialValue: Value,
  isFaulty: boolean,
  nodesAreReady: () => boolean,
  setNodeIsReady: (index: number) => void
) {
  const app = express();
  app.use(express.json());
  app.use(bodyParser.json());

  // Initialize node state
  let state: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: false, // Initially, no decision has been made
    k: 0, // Starting at round 0
  };

  let votes: { [key: string]: number } = {};

  // Define a function to handle the consensus decision-making process
  const handleDecisionMaking = () => {
    const voteCount = Object.values(votes).reduce((acc, count) => acc + count, 0);
    if (voteCount > (N / 2)) {
      // Majority is reached; decide on the most common value
      const majorityValue = Object.keys(votes).reduce((a, b) => votes[a] > votes[b] ? a : b);
      state.x = majorityValue === '1' ? 1 : 0; // Ensure state.x is set according to majority vote
      state.decided = true;
    } else {
      // No majority; choose randomly between 0 and 1
      state.x = Math.random() < 0.5 ? 0 : 1;
    }

    // Reset votes for the next round
    votes = {};
    if (!state.decided) {
      state.k += 1; // Move to the next round
      broadcastState(N, nodeId, state).catch(console.error); // Attempt to reach consensus in the next round
    }
  };

  // Status route
  app.get("/status", (req, res) => {
    res.status(isFaulty ? 500 : 200).send(isFaulty ? "faulty" : "live");
  });

  // GetState route
  app.get("/getState", (req, res) => {
    res.json(state);
  });

  // Message route for receiving votes and other communications
  app.post("/message", (req, res) => {
    if (!isFaulty) {
      const { x, k } = req.body;
      if (k === state.k) { // Ensure the message is for the current round
        votes[x] = (votes[x] || 0) + 1;
      }
      if (Object.keys(votes).length === N - F) { // Once all votes are in, decide
        handleDecisionMaking();
      }
      res.status(200).send("Vote received");
    } else {
      res.status(500).send("Node is faulty");
    }
  });

  // Start route for initiating the consensus algorithm
  app.get("/start", async (req, res) => {
    if (!isFaulty) {
      await broadcastState(N, nodeId, state).catch(console.error);
      res.status(200).send("Consensus process started");
    } else {
      res.status(500).send("Node is faulty");
    }
  });

  // Stop route for gracefully stopping a node
  app.get("/stop", (req, res) => {
    state = { killed: true, x: null, decided: null, k: null };
    res.status(200).send("Node stopped");
  });

  // Start the server
  const server = app.listen(BASE_NODE_PORT + nodeId, () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });

  return server;
}

