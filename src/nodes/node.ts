import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";
import fetch from 'cross-fetch';

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
        decided: false,
        k: 0,
    };

    let receivedVotes: Record<number, number[]> = {};

    // Update to handle votes accurately and make decision
    const processVotesAndDecide = () => {
        // Check if a majority has been reached in the current round
        const currentRoundVotes = receivedVotes[state.k] || [];
        const voteCounts = currentRoundVotes.reduce((acc, vote) => {
            acc[vote] = (acc[vote] || 0) + 1;
            return acc;
        }, {});

        // Determine if there's a majority vote
        let decidedValue = null;
        Object.entries(voteCounts).forEach(([vote, count]) => {
            if (count > N / 2) {
                decidedValue = parseInt(vote, 10);
            }
        });

        // Decision-making based on majority vote or random choice if undecided
        if (decidedValue !== null) {
            state.decided = true;
            state.x = decidedValue;
        } else {
            state.x = Math.random() < 0.5 ? 0 : 1; // Randomly choose between 0 and 1
            state.k += 1; // Move to the next round
        }

        // Broadcast state if not decided or continue to next round
        if (!state.decided) {
            broadcastState(N, nodeId, state);
        }
    };

    app.get("/status", (req, res) => {
        res.status(isFaulty ? 500 : 200).send(isFaulty ? "faulty" : "live");
    });

    app.get("/getState", (req, res) => {
        res.json(state);
    });

    app.post("/message", (req, res) => {
        if (!isFaulty) {
            const { senderId, k, x } = req.body;
            if (k === state.k) {
                receivedVotes[k] = receivedVotes[k] || [];
                receivedVotes[k].push(x);
                if (receivedVotes[k].length >= N - F) {
                    processVotesAndDecide();
                }
            }
            res.status(200).send("Vote received");
        } else {
            res.status(500).send("Node is faulty");
        }
    });

    app.get("/start", async (req, res) => {
        if (!isFaulty) {
            await broadcastState(N, nodeId, state);
            res.status(200).send("Consensus process started");
        } else {
            res.status(500).send("Node is faulty");
        }
    });

    app.get("/stop", (req, res) => {
        state = { killed: true, x: null, decided: null, k: 0 };
        res.status(200).send("Node stopped");
    });

    const server = app.listen(BASE_NODE_PORT + nodeId, () => {
        console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
        setNodeIsReady(nodeId);
    });

    return server;
}

