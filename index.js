require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.mvzvvjx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

async function run() {
    try {
        await client.connect();
        const db = client.db('debateArenaDB');
        const debateCollection = db.collection('debates');
        const joinedDebateCollection = db.collection('joinedDebate');
        const argumentsCollection = db.collection('leaderboard'); // This is your "arguments" collection with votes

        // GET all debates
        app.get('/debates', async (req, res) => {
            try {
                const debates = await debateCollection.find().toArray();
                res.json(debates);
            } catch (error) {
                console.error('Error fetching debates:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // POST create new debate
        app.post('/debates', async (req, res) => {
            const { title, description, tags, category, duration } = req.body;

            if (!title || !description || !tags || !category || !duration) {
                return res.status(400).json({ error: 'All fields are required' });
            }

            const newDebate = {
                title,
                description,
                tags,
                category,
                duration,
                support: [],
                oppose: [],
                createdAt: new Date(),
            };

            try {
                const result = await debateCollection.insertOne(newDebate);
                res.status(201).json({ message: 'Debate created', id: result.insertedId });
            } catch (error) {
                console.error('Error creating debate:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // POST join debate and store in joinedDebateCollection
        app.post('/debates/:id/join', async (req, res) => {
            const { id } = req.params;
            const { name, side } = req.body;

            if (!name || !['Support', 'Oppose'].includes(side)) {
                return res.status(400).json({ error: 'Name and valid side are required (Support or Oppose)' });
            }

            try {
                const debate = await debateCollection.findOne({ _id: new ObjectId(id) });
                if (!debate) return res.status(404).json({ error: 'Debate not found' });

                // Remove user from both sides first
                await debateCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $pull: { support: name, oppose: name } }
                );

                // Add user to selected side
                const sideField = side.toLowerCase();
                await debateCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $addToSet: { [sideField]: name } }
                );

                // Upsert into joinedDebateCollection
                await joinedDebateCollection.updateOne(
                    { debateId: id, name },
                    {
                        $set: {
                            debateId: id,
                            name,
                            side,
                            title: debate.title,
                            description: debate.description,
                            category: debate.category,
                            duration: debate.duration,
                            tags: debate.tags,
                            joinedAt: new Date(),
                        },
                    },
                    { upsert: true }
                );

                res.status(200).json({ message: `Successfully joined the debate as ${side}` });
            } catch (error) {
                console.error('Error joining debate:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // GET single debate by ID
        app.get('/debates/:id', async (req, res) => {
            const { id } = req.params;
            try {
                const debate = await debateCollection.findOne({ _id: new ObjectId(id) });
                if (!debate) return res.status(404).json({ error: 'Debate not found' });
                res.json(debate);
            } catch (error) {
                console.error('Error fetching debate:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // GET joined debate data for user by debateId and name
        app.get('/joinedDebates', async (req, res) => {
            const { name, debateId } = req.query;
            if (!name || !debateId) {
                return res.status(400).json({ error: 'Missing name or debateId query parameters' });
            }

            try {
                const joinedData = await joinedDebateCollection.findOne({ name, debateId });
                if (!joinedData) {
                    return res.status(404).json({ error: 'No joined debate found for this user and debate' });
                }
                res.json(joinedData);
            } catch (error) {
                console.error('Error fetching joined debate data:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // NEW: GET leaderboard with filters
        app.get('/leaderboard', async (req, res) => {
            const filter = req.query.filter || 'all'; // weekly, monthly, all
            const now = new Date();
            let startDate = null;

            if (filter === 'weekly') {
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
            } else if (filter === 'monthly') {
                startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
            }

            try {
                const matchStage = startDate ? { createdAt: { $gte: startDate } } : {};

                // Aggregate total votes and count unique debates per user
                const leaderboard = await argumentsCollection.aggregate([
                    { $match: matchStage },
                    {
                        $group: {
                            _id: { userName: "$userName", debateId: "$debateId" },
                            totalVotesPerDebate: { $sum: "$votes" }
                        }
                    },
                    {
                        $group: {
                            _id: "$_id.userName",
                            totalVotes: { $sum: "$totalVotesPerDebate" },
                            debatesParticipated: { $sum: 1 }
                        }
                    },
                    { $sort: { totalVotes: -1 } }
                ]).toArray();

                res.json(leaderboard);

            } catch (error) {
                console.error('Leaderboard error:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Confirm connection
        await client.db('admin').command({ ping: 1 });
        console.log('✅ Connected to MongoDB');
    } catch (err) {
        console.error('Failed to connect to MongoDB:', err);
    }
    // Keep connection alive
}

run().catch(console.error);

// Home route
app.get('/', (req, res) => {
    res.send('Debate Arena API running');
});

// Start server
app.listen(port, () => {
    console.log(`🚀 Server is running on port ${port}`);
});
