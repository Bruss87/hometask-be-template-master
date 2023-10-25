const express = require('express');
const bodyParser = require('body-parser');
const { sequelize } = require('./model')
const { getProfile } = require('./middleware/getProfile')
const app = express();
const { Op } = require("sequelize");
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

function parseDate(dateString) {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
        throw new Error('Invalid date');
    }
    return date;
}
/**
 * FIX ME!
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
    try {
        const { Contract } = req.app.get('models');
        const { id } = req.params;
        const profileId = req.profile.id;
        const contract = await Contract.findOne({
            where: {
                id,
                [Op.or]: [
                    { ContractorId: profileId },
                    { ClientId: profileId }
                ]
            }
        });
        if (!contract) return res.status(404).end();
        res.json(contract)
    }
    catch (error) {
        return res.status(500).json({ error: error.message })
    };
});


app.get('/contracts/', getProfile, async (req, res) => {
    try {
        const { Contract } = req.app.get('models');
        const profileId = req.profile.id;
        const contracts = await Contract.findAll({
            where: {
                [Op.or]: [
                    { ContractorId: profileId },
                    { ClientId: profileId }
                ],
                status: { [Op.notLike]: 'terminated' }
            }
        });
        if (!contracts) return res.status(404).end();
        res.json(contracts);
    }
    catch (error) {
        return res.status(500).json({ error: error.message })
    };
});

app.get('/jobs/unpaid', getProfile, async (req, res) => {
    try {
        const { Contract, Job } = req.app.get('models');
        const profileId = req.profile.id;
        const contracts = await Contract.findAll({
            where: {
                [Op.or]: [
                    { ContractorId: profileId },
                    { ClientId: profileId }
                ],
                status: { [Op.like]: 'in_progress' } // assuming here that "active" jobs from read me correspond to "in_progress" status from the DB -not including "new" jobs
            }
        });
        if (!contracts) return res.status(404).end();
        const contractIds = contracts.map(contract => contract.id)
        const jobs = await Job.findAll({
            where: {
                ContractId: { [Op.in]: contractIds }
            }
        });
        if (!jobs) return res.status(404).end();
        res.json(jobs);
    }
    catch (error) {
        return res.status(500).json({ error: error.message })
    };
});


app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
    try {
        const { Profile, Job, Contract } = req.app.get('models');
        const { job_id } = req.params;
        const profileId = req.profile.id;
        const clientProfile = await Profile.findOne({ where: { id: profileId, type: { [Op.like]: 'client' } } });
        const clientsBalance = clientProfile.balance;

        const jobToPay = await Job.findOne({ where: { id: job_id } });
        const amountToPay = jobToPay.price;

        const contract = await Contract.findOne({ where: { id: jobToPay.ContractId } });

        if (clientsBalance >= amountToPay) {
            await Job.update({ paid: 1, paymentDate: Date.now() }, { where: { id: job_id } }); // assuming only jobs that have paid with null value can be paid, and only once.
            await Profile.increment({ balance: amountToPay }, { where: { id: contract.ContractorId }, type: { [Op.like]: 'contractor' } });
            await Profile.increment({ balance: -amountToPay }, { where: { id: clientProfile.id }, type: { [Op.like]: 'client' } });
            return res.status(200).json({ status: 'ok' })
        }
        throw new Error('Your balance is too low to pay for this job.');
    } catch (error) {
        return res.status(500).json({ error: error.message })
    };
});

app.post('/balances/deposit/:userId', getProfile, async (req, res) => {
    try {
        const { Profile, Job, Contract } = req.app.get('models');
        const { userId } = req.params;
        const profileId = req.profile.id;

        const contracts = await Contract.findAll({ where: { ClientId: profileId } });
        const contractIds = contracts.map(contract => contract.id);

        const totalUnpaidAmount = await Job.sum('price', {
            where: {
                ContractId: { [Op.in]: contractIds }, paid: { [Op.is]: null, }
            }
        });
        const allowedDepositAmount = totalUnpaidAmount * 0.25;
        await Profile.increment({ balance: allowedDepositAmount }, { where: { id: userId }, type: { [Op.like]: 'client' } });
        return res.status(200).json({ status: 'ok' })
    }
    catch (error) {
        return res.status(500).json({ error: error.message })
    };
});

app.get('/admin/best-profession', getProfile, async (req, res) => {
    try {
        const { Profile } = req.app.get('models');
        const { startDate, endDate } = req.query;

        const result = await Profile.findAll({
            attributes: [
                'profession',
                [sequelize.literal('(SELECT SUM("Jobs"."price") FROM "Contracts" AS "Contract" LEFT JOIN "Jobs" ON "Contract"."id" = "Jobs"."ContractId" WHERE "Contract"."ContractorId" = "Profile"."id" AND "Jobs"."paid" = true AND "Jobs"."paymentDate" BETWEEN ? AND ?)'), 'totalEarnings'],
            ],
            where: {
                type: 'contractor',
            },
            replacements: [startDate, endDate],
            type: sequelize.QueryTypes.SELECT,
            raw: true,
            order: [[sequelize.literal('totalEarnings'), 'DESC']],
        });
        res.json(result[0].profession)
    }
    catch (error) {
        return res.status(500).json({ error: error.message })
    };
});

app.get('/admin/best-clients', getProfile, async (req, res) => {
    try {
        const { Profile } = req.app.get('models');
        const { startDate, endDate } = req.query;
        const limit = req.query.limit || 2;
        const result = await Profile.findAll({
          attributes: [
            'id',
            'firstName',
            'lastName',
            [
              sequelize.literal(
                `(SELECT SUM("Jobs"."price") FROM "Contracts" AS "Contract" ` +
                `LEFT JOIN "Jobs" ON "Contract"."id" = "Jobs"."ContractId" ` +
                `WHERE "Contract"."ClientId" = "Profile"."id" ` +
                `AND "Jobs"."paid" = true ` +
                `AND "Jobs"."paymentDate" BETWEEN :startDate AND :endDate)`
              ),
              'totalPaid',
            ],
          ],
          where: {
            type: 'client',
          },
          replacements: { startDate, endDate },
          type: sequelize.QueryTypes.SELECT,
          raw: true,
          order: [[sequelize.literal('totalPaid'), 'DESC']],
          limit: limit,
        });
        res.json(result)
    }
    catch (error) {
        return res.status(500).json({ error: error.message })
    };
});
module.exports = app;