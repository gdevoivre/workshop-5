import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";
import fetch from 'node-fetch'; // Confirm this import works or adjust based on your project setup

// Correct the function parameters' types
async function broadcastState(N: number, nodeId: number, nodeState: NodeState): Promise<void> {
  const promises = [];
  for (let i = 0; i < N; i++) {
    if (i !== nodeId) { // Avoid sending message to self
      const url = `http://localhost:${BASE_NODE_PORT + i}/message`;
      promises.push(
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ senderId: nodeId, ...nodeState }),
        })
      );
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
    decided: null,
    k: null,
  };

  // Status route
  app.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  // GetState route
  app.get("/getState", (req, res) => {
    res.json(state);
  });

  // Message route for receiving votes and other communications
  let votes: { [key: string]: number } = { '0': 0, '1': 0 }; // Correctly type the votes object

  app.post("/message", (req, res) => {
    if (!isFaulty) {
      const { x } = req.body;
      if (typeof x === 'string' && votes.hasOwnProperty(x)) {
        votes[x] += 1;
      }
      // Process votes here and adjust state as necessary
      res.status(200).send("Vote received");
    } else {
      res.status(500).send("Node is faulty");
    }
  });

  // Start route for initiating the consensus algorithm
  app.get("/start", async (req, res) => {
    if (!isFaulty) {
      state.k = 0;
      await broadcastState(N, nodeId, state);
      res.status(200).send("Consensus process started");
    } else {
      res.status(500).send("Node is faulty");
    }
  });

  // Stop route for gracefully stopping a node
  app.get("/stop", (req, res) => {
    state = {
      ...state,
      killed: true,
      x: null,
      decided: null,
      k: null,
    };
    res.status(200).send("Node stopped");
  });

  // Start the server
  const server = app.listen(BASE_NODE_PORT + nodeId, () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });

  return server;
}
