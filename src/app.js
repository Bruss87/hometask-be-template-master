const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model')
const {getProfile} = require('./middleware/getProfile')
const app = express();
const { Op } = require("sequelize");
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * FIX ME!
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile, async (req, res) =>{
    const {Contract} = req.app.get('models');
    const {id} = req.params;
    const profileId = req.profile.id;
    if(!profileId) return res.status(404).end();
    const contract = await Contract.findOne({where: {
        id,
        [Op.or]: [
            { ContractorId: profileId },
            { ClientId: profileId }
          ]
    }});
    if(!contract) return res.status(404).end();
    res.json(contract);
});

/**
 * @returns all contracts for the authenticated user
 */
app.get('/contracts/', getProfile, async (req, res) =>{
    const {Contract} = req.app.get('models');
    const profileId = req.profile.id;
    if(!profileId) return res.status(404).end();
    const contracts = await Contract.findAll({where: {
        [Op.or]: [
            { ContractorId: profileId },
            { ClientId: profileId }
          ],
        status: { [Op.notLike]: 'terminated'}
    }});
    if(!contracts) return res.status(404).end();
    res.json(contracts);
});

app.get('/jobs/unpaid', getProfile, async (req, res) => {
    const {Contract, Job} = req.app.get('models');
    const profileId = req.profile.id;
    if(!profileId) return res.status(404).end();
    const contracts = await Contract.findAll({where: {
        [Op.or]: [
            { ContractorId: profileId },
            { ClientId: profileId }
          ],
        status: { [Op.like]: 'in_progress'} // assuming here that "active" jobs from read me correspond to "in_progress" status from the DB -not including "new" jobs
    }});
    if(!contracts) return res.status(404).end();
    const contractIds = contracts.map(contract =>  contract.id)
    const jobs = await Job.findAll({where: {
        ContractId:{ [Op.in]: contractIds}
    }});
    if(!jobs) return res.status(404).end();
    res.json(jobs);
});


app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
    const { Profile, Job, Contract } = req.app.get('models');
    const {job_id}= req.params;
    const profileId = req.profile.id;
    if(!profileId) return res.status(404).end();
    const clientProfile = await Profile.findOne({where: {id: profileId, type: {[Op.like]: 'client'}}});
    const clientsBalance = clientProfile.balance;

    const jobToPay = await Job.findOne({where: { id: job_id}});
    const amountToPay = jobToPay.price;

    const contract = await Contract.findOne({where: { id: jobToPay.ContractId}});

    if(clientsBalance >= amountToPay) {
        await Job.update({paid: 1, paymentDate: Date.now()},{where: { id: job_id}}); // assuming only jobs that have paid with null value can be paid, and only once.
        await Profile.increment({balance: amountToPay},{where: { id: contract.ContractorId}, type: {[Op.like]: 'contractor'}});
        await Profile.increment({balance: -amountToPay},{where: { id: clientProfile.id}, type: {[Op.like]: 'client'}});   
     return res.status(200).json({ status: 'ok' })
    };
    return res.status(500).json({error: 'Your balance is too low to pay for this job.'})
});
module.exports = app;
