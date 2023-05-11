/* eslint-env mocha */
/* global artifacts, contract, web3, it, beforeEach */
const hre = require("hardhat");
const { assert, expect } = require("chai");
const { expectRevert, expectEvent, BN } = require("@openzeppelin/test-helpers");
const { getEventFromTx } = require("../../helpers/utils")
const { impersonate } = require("../../helpers/impersonate");
const constants = require("../../helpers/constants");
const { web3 } = require("@openzeppelin/test-helpers/src/setup");
const { keccak256 } = require("@ethersproject/keccak256");
const ethers = hre.ethers;
const { ecsign, zeroAddress } = require("ethereumjs-util");
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants");


const getDomainSeparator = (name, tokenAddress, chainId) => {
    return keccak256(
        ethers.utils.defaultAbiCoder.encode(
            ["bytes32", "bytes32", "bytes32", "uint256", "address"],
            [
                keccak256(
                    ethers.utils.toUtf8Bytes(
                        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                    )
                ),
                keccak256(ethers.utils.toUtf8Bytes(name)),
                keccak256(ethers.utils.toUtf8Bytes("1")),
                chainId,
                tokenAddress,
            ]
        )
    );
};
const PERMIT_TYPEHASH = keccak256(
    ethers.utils.toUtf8Bytes(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    )
);

const getApprovalDigest = async (
    token,
    owner,
    spender,
    value,
    nonce,
    deadline,
    chainId
) => {
    const name = await token.name();
    const DOMAIN_SEPARATOR = getDomainSeparator(name, token.address, chainId);
    return keccak256(
        ethers.utils.solidityPack(
            ["bytes1", "bytes1", "bytes32", "bytes32"],
            [
                "0x19",
                "0x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    ethers.utils.defaultAbiCoder.encode(
                        ["bytes32", "address", "address", "uint256", "uint256", "uint256"],
                        [PERMIT_TYPEHASH, owner, spender, value, nonce, deadline]
                    )
                ),
            ]
        )
    );
};
const provider = new ethers.providers.JsonRpcProvider();

async function signMessage(message, address) {
    let signedMessage = await web3.eth.sign(message, address)
    signedMessage = signedMessage.substr(2) // remove 0x
    const r = '0x' + signedMessage.slice(0, 64)
    const s = '0x' + signedMessage.slice(64, 128)
    const v = '0x' + signedMessage.slice(128, 130)
    const vDecimal = web3.utils.hexToNumber(v)
    return { v, r, s };
    /*const { v, r, s } = ecsign(
      Buffer.from(message.slice(2), "hex"),
      Buffer.from(privateKey, "hex")
    );
    return { v, r, s };
    */
}


describe("ERC20TemplatePredictoor", () => {
    let name,
        symbol,
        owner,
        reciever,
        metadata,
        tokenERC721,
        tokenAddress,
        data,
        flags,
        factoryERC721,
        factoryERC20,
        templateERC721,
        templateERC20,
        erc20Address,
        erc20Token,
        erc20AddressWithPublishFee,
        erc20TokenWithPublishFee,
        publishMarketFeeAddress,
        mockErc20,
        mockErc20Decimals,
        publishMarketFeeToken

    cap = web3.utils.toWei("100000");
    const fakeUSDAmount = cap

    const communityFeeCollector = "0xeE9300b7961e0a01d9f0adb863C7A227A07AaD75";
    const publishMarketFeeAmount = "5"
    const addressZero = '0x0000000000000000000000000000000000000000';
    const noLimit = web3.utils.toWei('100000000000000000000');

    beforeEach("init contracts for each test", async () => {
        const ERC721Template = await ethers.getContractFactory("ERC721Template");
        const ERC20TemplatePredictoor = await ethers.getContractFactory("ERC20TemplatePredictoor");
        const ERC721Factory = await ethers.getContractFactory("ERC721Factory");

        const Router = await ethers.getContractFactory("FactoryRouter");
        const FixedRateExchange = await ethers.getContractFactory(
            "FixedRateExchange"
        );

        const MockErc20 = await ethers.getContractFactory('MockERC20');
        const MockErc20Decimals = await ethers.getContractFactory('MockERC20Decimals');

        [owner, reciever, user2, user3, user4, user5, user6, opcCollector, marketFeeCollector, publishMarketAccount] = await ethers.getSigners();
        publishMarketFeeAddress = publishMarketAccount.address
        data = web3.utils.asciiToHex(constants.blob[0]);
        flags = web3.utils.asciiToHex(constants.blob[0]);

        // DEPLOY ROUTER, SETTING OWNER



        mockErc20 = await MockErc20.deploy(owner.address, "MockERC20", 'MockERC20');
        mockErc20Decimals = await MockErc20Decimals.deploy("Mock6Digits", 'Mock6Digits', 6);
        publishMarketFeeToken = mockErc20Decimals.address

        router = await Router.deploy(
            owner.address,
            '0x000000000000000000000000000000000000dead', // approved tokens list, unused in this test
            '0x000000000000000000000000000000000000dead', // pooltemplate field, unused in this test
            opcCollector.address,
            []
        );



        fixedRateExchange = await FixedRateExchange.deploy(
            router.address
        );

        templateERC20 = await ERC20TemplatePredictoor.deploy();


        // SETUP ERC721 Factory with template
        templateERC721 = await ERC721Template.deploy();
        factoryERC721 = await ERC721Factory.deploy(
            templateERC721.address,
            templateERC20.address,
            router.address
        );

        // SET REQUIRED ADDRESS


        await router.addFactory(factoryERC721.address);

        await router.addFixedRateContract(fixedRateExchange.address); // DEPLOY ROUTER, SETTING OWNER




        // by default connect() in ethers goes with the first address (owner in this case)
        const tx = await factoryERC721.deployERC721Contract(
            "NFT",
            "NFTSYMBOL",
            1,
            "0x0000000000000000000000000000000000000000",
            "0x0000000000000000000000000000000000000000",
            "https://oceanprotocol.com/nft/",
            true,
            owner.address
        );
        const txReceipt = await tx.wait();
        let event = getEventFromTx(txReceipt, 'NFTCreated')
        assert(event, "Cannot find NFTCreated event")
        tokenAddress = event.args[0];
        tokenERC721 = await ethers.getContractAt("ERC721Template", tokenAddress);

        assert((await tokenERC721.balanceOf(owner.address)) == 1);

        await tokenERC721.addManager(user2.address);
        await tokenERC721.connect(user2).addTo725StoreList(user3.address);
        await tokenERC721.connect(user2).addToCreateERC20List(user3.address);
        await tokenERC721.connect(user2).addToMetadataList(user3.address);

        assert((await tokenERC721.getPermissions(user3.address)).store == true);
        assert(
            (await tokenERC721.getPermissions(user3.address)).deployERC20 == true
        );
        assert(
            (await tokenERC721.getPermissions(user3.address)).updateMetadata == true
        );


        // [user3.address, user6.address, user3.address, addressZero, mockErc20.address],

        const trxERC20 = await tokenERC721.connect(user3).createERC20(1,
            ["ERC20DT3", "ERC20DT3Symbol"],
            [user3.address, user6.address, user3.address, addressZero, mockErc20.address],
            [cap, 0, 24, 288, 24 * 60 * 60, 24 * 60 * 60 * 3],
            []
        );

        const trxReceiptERC20 = await trxERC20.wait();
        event = getEventFromTx(trxReceiptERC20, 'TokenCreated')
        assert(event, "Cannot find TokenCreated event")
        erc20Address = event.args[0];

        erc20Token = await ethers.getContractAt("ERC20TemplatePredictoor", erc20Address);
        assert((await erc20Token.permissions(user3.address)).minter == true);


        // create an ERC20 with publish Fee ( 5 USDC, going to publishMarketAddress)
        const trxERC20WithPublishFee = await tokenERC721.connect(user3).createERC20(1,
            ["ERC20DT3P", "ERC20DT3SymbolP"],
            [user3.address, user6.address, publishMarketFeeAddress, publishMarketFeeToken, mockErc20.address],
            [cap, web3.utils.toWei(publishMarketFeeAmount), 24, 288, 24 * 60 * 60, 24 * 60 * 60 * 3],
            []

        );
        const trxReceiptERC20WithPublishFee = await trxERC20WithPublishFee.wait();
        event = getEventFromTx(trxReceiptERC20WithPublishFee, 'TokenCreated')
        assert(event, "Cannot find TokenCreated event")
        erc20AddressWithPublishFee = event.args[0];

        erc20TokenWithPublishFee = await ethers.getContractAt("ERC20TemplatePredictoor", erc20AddressWithPublishFee);
        assert((await erc20TokenWithPublishFee.permissions(user3.address)).minter == true);

    });


    it("#isInitialized - should check that the erc20Token contract is initialized", async () => {
        expect(await erc20Token.isInitialized()).to.equal(true);
    });

    it("#initialize - should fail to re-initialize the contracts", async () => {
        await expectRevert(
            erc20Token.initialize(
                ["ERC20DT3", "ERC20DT3Symbol"],
                [owner.address, marketFeeCollector.address, owner.address, addressZero],
                [tokenERC721.address, communityFeeCollector, router.address, erc20Token.address],
                [web3.utils.toWei("10"), 0, 24, 300, 24 * 60 * 60],
                []
            ),
            "ERC20Template: token instance already initialized"
        );
    });

    it("#mint - user3 (minter role) should succeed to mint 1 ERC20Token to user2", async () => {
        await erc20Token.connect(user3).mint(user2.address, web3.utils.toWei("1"));
        assert(
            (await erc20Token.balanceOf(user2.address)) == web3.utils.toWei("1")
        );
    });

    it("#mint - should fail to mint 1 ERC20Token to user2 if NOT MINTER", async () => {
        await expectRevert(
            erc20Token.connect(user2).mint(user2.address, web3.utils.toWei("1")),
            "ERC20Template: NOT MINTER"
        );
    });

    it("#setPaymentCollector - should not modify paymentCollector address", async () => {
        await erc20Token.connect(user3).setPaymentCollector(owner.address);
        assert((await erc20Token.getPaymentCollector()) == erc20Token.address, 'PaymentCollector is not erc20Token');
        await erc20Token.connect(user3).setPaymentCollector(user2.address);
        assert((await erc20Token.getPaymentCollector()) == erc20Token.address, 'PaymentCollector is not erc20Token');

    });

    it("#getERC721Address - should succeed to get the parent ERC721 address", async () => {
        const address = await erc20Token.connect(user3).getERC721Address();
        assert(address, "Not able to get the parent ERC721 address")
    });

    it("#addMinter - should fail to addMinter if not erc20Deployer (permission to deploy the erc20Contract at 721 level)", async () => {
        assert((await erc20Token.permissions(user2.address)).minter == false);

        await expectRevert(
            erc20Token.connect(user2).addMinter(user2.address),
            "ERC20Template: NOT DEPLOYER ROLE"
        );

        assert((await erc20Token.permissions(user2.address)).minter == false);
    });

    it("#addMinter - should fail to addMinter if it's already minter", async () => {
        assert((await erc20Token.permissions(user2.address)).minter == false);

        await erc20Token.connect(user3).addMinter(user2.address);

        assert((await erc20Token.permissions(user2.address)).minter == true);

        await expectRevert(
            erc20Token.connect(user3).addMinter(user2.address),
            "ERC20Roles:  ALREADY A MINTER"
        );
    });

    it("#addMinter - should succeed to addMinter if erc20Deployer (permission to deploy the erc20Contract at 721 level)", async () => {
        assert((await erc20Token.permissions(user2.address)).minter == false);

        // owner is already erc20Deployer
        await erc20Token.connect(user3).addMinter(user2.address);

        assert((await erc20Token.permissions(user2.address)).minter == true);
    });

    it("#removeMinter - should fail to removeMinter if NOT erc20Deployer", async () => {
        await erc20Token.connect(user3).addMinter(user2.address);
        assert((await erc20Token.permissions(user2.address)).minter == true);

        await expectRevert(
            erc20Token.connect(user2).removeMinter(user2.address),
            "ERC20Template: NOT DEPLOYER ROLE"
        );

        assert((await erc20Token.permissions(user2.address)).minter == true);
    });

    it("#removeMinter - should fail to removeMinter even if it's minter", async () => {
        await erc20Token.connect(user3).addMinter(user2.address);

        assert((await erc20Token.permissions(user2.address)).minter == true);

        await expectRevert(
            erc20Token.connect(user4).removeMinter(user2.address),
            "ERC20Template: NOT DEPLOYER ROLE"
        );

        assert((await erc20Token.permissions(user2.address)).minter == true);
    });

    it("#removeMinter - should succeed to removeMinter if erc20Deployer", async () => {
        await erc20Token.connect(user3).addMinter(user2.address);

        assert((await erc20Token.permissions(user2.address)).minter == true);

        assert((await tokenERC721.getPermissions(user3.address)).deployERC20 == true)

        await erc20Token.connect(user3).removeMinter(user2.address);

        assert((await erc20Token.permissions(user2.address)).minter == false);
    });

    it("#addPaymentManager - should fail to addPaymentManager if not erc20Deployer (permission to deploy the erc20Contract at 721 level)", async () => {
        assert((await erc20Token.permissions(user2.address)).paymentManager == false);

        await expectRevert(
            erc20Token.connect(user2).addPaymentManager(user2.address),
            "ERC20Template: NOT DEPLOYER ROLE"
        );

        assert((await erc20Token.permissions(user2.address)).paymentManager == false);
    });

    it("#addPaymentManager - should fail to addPaymentManager if it's already feeManager", async () => {
        assert((await erc20Token.permissions(user2.address)).paymentManager == false);

        await erc20Token.connect(user3).addPaymentManager(user2.address);

        assert((await erc20Token.permissions(user2.address)).paymentManager == true);

        await expectRevert(
            erc20Token.connect(user3).addPaymentManager(user2.address),
            "ERC20Roles:  ALREADY A FEE MANAGER"
        );
    });

    it("#addPaymentManager - should succeed to addPaymentManager if erc20Deployer (permission to deploy the erc20Contract at 721 level)", async () => {
        assert((await erc20Token.permissions(user2.address)).paymentManager == false);

        // owner is already erc20Deployer
        await erc20Token.connect(user3).addPaymentManager(user2.address);

        assert((await erc20Token.permissions(user2.address)).paymentManager == true);
    });

    it("#removeFeeManager - should fail to removeFeeManager if NOT erc20Deployer", async () => {
        await erc20Token.connect(user3).addPaymentManager(owner.address);

        assert((await erc20Token.permissions(owner.address)).paymentManager == true);

        await expectRevert(
            erc20Token.connect(user2).removePaymentManager(owner.address),
            "ERC20Template: NOT DEPLOYER ROLE"
        );

        assert((await erc20Token.permissions(owner.address)).paymentManager == true);
    });

    it("#removeFeeManager - should fail to removeFeeManager even if it's feeManager", async () => {
        // ERC20 deployer role add himself as manager and user2
        await erc20Token.connect(user3).addPaymentManager(owner.address);
        await erc20Token.connect(user3).addPaymentManager(user2.address);

        assert((await erc20Token.permissions(user2.address)).paymentManager == true);

        await expectRevert(
            erc20Token.connect(user2).removePaymentManager(owner.address),
            "ERC20Template: NOT DEPLOYER ROLE"
        );

        assert((await erc20Token.permissions(owner.address)).paymentManager == true);
    });

    it("#removeFeeManager - should succeed to removeFeeManager if erc20Deployer", async () => {
        await erc20Token.connect(user3).addPaymentManager(user2.address);

        assert((await erc20Token.permissions(user2.address)).paymentManager == true);

        await erc20Token.connect(user3).removePaymentManager(user2.address);

        assert((await erc20Token.permissions(user2.address)).paymentManager == false);
    });

    it("#setData - should fail to setData if NOT erc20Deployer", async () => {
        const key = web3.utils.keccak256(erc20Token.address);
        const value = web3.utils.asciiToHex("SomeData");

        await expectRevert(
            erc20Token.connect(user2).setData(value),
            "ERC20Template: NOT DEPLOYER ROLE"
        );

        assert((await tokenERC721.getData(key)) == "0x");
    });

    it("#setData - should succeed to setData if erc20Deployer", async () => {
        const key = web3.utils.keccak256(erc20Token.address);
        const value = web3.utils.asciiToHex("SomeData");

        await erc20Token.connect(user3).setData(value);

        assert((await tokenERC721.getData(key)) == value);
    });

    it("#cleanPermissions - should fail to call cleanPermissions if NOT NFTOwner", async () => {
        assert((await erc20Token.permissions(user3.address)).minter == true);
        await expectRevert(
            erc20Token.connect(user2).cleanPermissions(),
            "ERC20Template: not NFTOwner"
        );

        assert((await erc20Token.permissions(user3.address)).minter == true);
    });

    it("#cleanPermissions - should succeed to call cleanPermissions if NFTOwner", async () => {
        // user3 is already minter

        assert((await erc20Token.permissions(user3.address)).minter == true);
        await erc20Token.connect(user3).addPaymentManager(owner.address);
        // WE add 2 more minters
        await erc20Token.connect(user3).addMinter(user2.address);
        await erc20Token.connect(user3).addMinter(user4.address);
        assert((await erc20Token.permissions(user2.address)).minter == true);
        assert((await erc20Token.permissions(user4.address)).minter == true);

        // NFT Owner cleans
        await erc20Token.cleanPermissions();

        // check permission were removed
        assert((await erc20Token.permissions(owner.address)).minter == false);
        assert((await erc20Token.permissions(owner.address)).paymentManager == false);
        assert((await erc20Token.permissions(user2.address)).minter == false);
        assert((await erc20Token.permissions(user3.address)).minter == false);
        assert((await erc20Token.permissions(user4.address)).minter == false);
        assert((await erc20Token.getPaymentCollector()) == erc20Token.address);
    });

    it("#startOrder - user should succeed to call startOrder on a ERC20 without publishFee", async () => {

        //MINT SOME DT20 to USER2 so he can start order
        await erc20Token.connect(user3).mint(user2.address, web3.utils.toWei("10"));
        assert(
            (await erc20Token.balanceOf(user2.address)) == web3.utils.toWei("10")
        );
        const consumer = user2.address; // could be different user
        const dtAmount = web3.utils.toWei("1");
        const serviceIndex = 1; // dummy index
        const providerFeeAddress = user5.address; // marketplace fee Collector
        const providerFeeAmount = 0; // fee to be collected on top, requires approval
        const providerFeeToken = mockErc20.address; // token address for the feeAmount,
        const consumeMarketFeeAddress = user5.address; // marketplace fee Collector
        const consumeMarketFeeAmount = 0; // fee to be collected on top, requires approval
        const consumeMarketFeeToken = mockErc20.address; // token address for the feeAmount,
        const providerValidUntil = 0;
        //sign provider data
        const providerData = JSON.stringify({ "timeout": 0 })
        const message = ethers.utils.solidityKeccak256(
            ["bytes", "address", "address", "uint256", "uint256"],
            [
                ethers.utils.hexlify(ethers.utils.toUtf8Bytes(providerData)),
                providerFeeAddress,
                providerFeeToken,
                providerFeeAmount,
                providerValidUntil
            ]
        );
        const signedMessage = await signMessage(message, providerFeeAddress);
        const tx = await erc20Token
            .connect(user2)
            .startOrder(
                consumer,
                serviceIndex,
                {
                    providerFeeAddress: providerFeeAddress,
                    providerFeeToken: providerFeeToken,
                    providerFeeAmount: providerFeeAmount,
                    v: signedMessage.v,
                    r: signedMessage.r,
                    s: signedMessage.s,
                    providerData: ethers.utils.hexlify(ethers.utils.toUtf8Bytes(providerData)),
                    validUntil: providerValidUntil
                },
                {
                    consumeMarketFeeAddress: consumeMarketFeeAddress,
                    consumeMarketFeeToken: consumeMarketFeeToken,
                    consumeMarketFeeAmount: consumeMarketFeeAmount,
                }
            );
        const txReceipt = await tx.wait();
        let event = getEventFromTx(txReceipt, 'OrderStarted')
        assert(event, "Cannot find OrderStarted event")
        //make sure that we don't have 'PublishMarketFee') event
        event = getEventFromTx(txReceipt, 'PublishMarketFee')
        assert.typeOf(event, 'undefined', "PublishMarketFee event found")
        //make sure that we have ProviderFee event
        event = getEventFromTx(txReceipt, 'ProviderFee')

        assert(
            (await erc20Token.balanceOf(user2.address)) == web3.utils.toWei("9"), 'Invalid user balance, DT was not substracted'
        );

        assert(
            (await erc20Token.balanceOf(opcCollector.address)) ==
            web3.utils.toWei("0.0"), 'Invalid OPF balance, we should get 0.03 DTs'
        );
        assert(
            (await erc20Token.balanceOf(user3.address)) == web3.utils.toWei("0"), 'Invalid consumeFee, we should have DT as fee'
        );
        assert(
            (await erc20Token.balanceOf(await erc20Token.getPaymentCollector())) ==
            web3.utils.toWei("0.0"), 'Invalid publisher reward, we should have 0.0 DT'
        );
    });


    it("#startOrder - user should succeed to call startOrder on a ERC20 without publishFee and provider Fee", async () => {

        //MINT SOME DT20 to USER2 so he can start order
        await erc20Token.connect(user3).mint(user2.address, web3.utils.toWei("10"));
        assert(
            (await erc20Token.balanceOf(user2.address)) == web3.utils.toWei("10")
        );
        const consumer = user2.address; // could be different user
        const dtAmount = web3.utils.toWei("1");
        const serviceIndex = 1; // dummy index
        const providerFeeAddress = user5.address; // marketplace fee Collector
        const providerFeeAmount = '1'; // fee to be collected on top, requires approval
        const providerFeeToken = mockErc20.address; // token address for the feeAmount, in this case DAI
        const providerValidUntil = 0;
        const consumeMarketFeeAddress = user5.address; // marketplace fee Collector
        const consumeMarketFeeAmount = 0; // fee to be collected on top, requires approval
        const consumeMarketFeeToken = mockErc20.address; // token address for the feeAmount,

        // GET SOME consumeFeeToken
        const Mock20Contract = await ethers.getContractAt(
            "contracts/interfaces/IERC20.sol:IERC20",
            mockErc20.address
        );
        await Mock20Contract
            .connect(owner)
            .transfer(user2.address, ethers.utils.parseEther(providerFeeAmount));

        // we approve the erc20Token contract to pull feeAmount (3 DAI)

        await Mock20Contract
            .connect(user2)
            .approve(erc20Token.address, web3.utils.toWei(providerFeeAmount));

        //sign provider data
        const providerData = JSON.stringify({ "timeout": 0 });
        const message = ethers.utils.solidityKeccak256(
            ["bytes", "address", "address", "uint256", "uint256"],
            [
                ethers.utils.hexlify(ethers.utils.toUtf8Bytes(providerData)),
                providerFeeAddress,
                providerFeeToken,
                providerFeeAmount,
                providerValidUntil
            ]
        );
        const signedMessage = await signMessage(message, providerFeeAddress);
        const tx = await erc20Token
            .connect(user2)
            .startOrder(
                consumer,
                serviceIndex,
                {
                    providerFeeAddress: providerFeeAddress,
                    providerFeeToken: providerFeeToken,
                    providerFeeAmount: providerFeeAmount,
                    v: signedMessage.v,
                    r: signedMessage.r,
                    s: signedMessage.s,
                    providerData: ethers.utils.hexlify(ethers.utils.toUtf8Bytes(providerData)),
                    validUntil: providerValidUntil
                },
                {
                    consumeMarketFeeAddress: consumeMarketFeeAddress,
                    consumeMarketFeeToken: consumeMarketFeeToken,
                    consumeMarketFeeAmount: consumeMarketFeeAmount,
                }
            );
        const txReceipt = await tx.wait();
        let event = getEventFromTx(txReceipt, 'OrderStarted')
        assert(event, "Cannot find OrderStarted event")
        //make sure that we don't have 'PublishMarketFee') event
        event = getEventFromTx(txReceipt, 'PublishMarketFee')
        assert.typeOf(event, 'undefined', "PublishMarketFee event found")
        //make sure that we have ProviderFee event
        event = getEventFromTx(txReceipt, 'ProviderFee')
        assert(
            (await erc20Token.balanceOf(user2.address)) == web3.utils.toWei("9"), 'Invalid user balance, DT was not substracted'
        );

        assert(
            (await erc20Token.balanceOf(opcCollector.address)) ==
            web3.utils.toWei("0.0"), 'Invalid OPF balance, we should get 0.03 DTs'
        );
        assert(
            (await erc20Token.balanceOf(user3.address)) == web3.utils.toWei("0"), 'Invalid consumeFee, we should have DT as fee'
        );
        assert(
            (await erc20Token.balanceOf(await erc20Token.getPaymentCollector())) ==
            web3.utils.toWei("0.0"), 'Invalid publisher reward, we should have 0.97 DT'
        );
    });


    it("#startOrder - user should be able to get getPublishingMarketFee", async () => {
        const publishFee = await erc20TokenWithPublishFee
            .connect(user2)
            .getPublishingMarketFee();
        assert(publishFee[0] = publishMarketFeeAddress)
        assert(publishFee[1] = publishMarketFeeToken)
        assert(publishFee[2] = web3.utils.toWei(publishMarketFeeAmount))

    });


    //////////
    it("#startOrder - user should succeed to call startOrder on a ERC20 with 5 USDC publishFee, providerFee is ZERO and 5 USDC consumeFee", async () => {

        //MINT SOME DT20 to USER2 so he can start order
        await erc20TokenWithPublishFee.connect(user3).mint(user2.address, web3.utils.toWei("10"));
        assert(
            (await erc20TokenWithPublishFee.balanceOf(user2.address)) == web3.utils.toWei("10")
        );
        const publishFee = await erc20TokenWithPublishFee
            .connect(user2)
            .getPublishingMarketFee();
        const Mock20DecimalContract = await ethers.getContractAt(
            "contracts/interfaces/IERC20.sol:IERC20",
            publishFee[1]
        );

        const consumer = user2.address; // could be different user
        const dtAmount = web3.utils.toWei("1");
        const serviceIndex = 1; // dummy index
        const providerFeeAddress = user5.address; // marketplace fee Collector
        const providerFeeAmount = 0; // fee to be collected on top, requires approval
        const providerFeeToken = mockErc20.address; // token address for the feeAmount, in this case DAI
        const consumeMarketFeeAddress = user5.address; // marketplace fee Collector
        const consumeMarketFeeAmount = publishFee[2]; // fee to be collected on top, requires approval
        const consumeMarketFeeToken = Mock20DecimalContract.address; // token address for the feeAmount,

        // GET SOME consumeFeeToken
        await Mock20DecimalContract
            .connect(owner)
            .transfer(user2.address, publishFee[2].add(consumeMarketFeeAmount));

        // we approve the erc20Token contract to pull feeAmount
        await Mock20DecimalContract
            .connect(user2)
            .approve(erc20TokenWithPublishFee.address, publishFee[2].add(consumeMarketFeeAmount));

        //sign provider data
        const providerData = JSON.stringify({ "timeout": 0 })
        const providerValidUntil = 0;
        const message = ethers.utils.solidityKeccak256(
            ["bytes", "address", "address", "uint256", "uint256"],
            [
                ethers.utils.hexlify(ethers.utils.toUtf8Bytes(providerData)),
                providerFeeAddress,
                providerFeeToken,
                providerFeeAmount,
                providerValidUntil
            ]
        );

        const signedMessage = await signMessage(message, providerFeeAddress);

        const tx = await erc20TokenWithPublishFee
            .connect(user2)
            .startOrder(
                consumer,
                serviceIndex,
                {
                    providerFeeAddress: providerFeeAddress,
                    providerFeeToken: providerFeeToken,
                    providerFeeAmount: providerFeeAmount,
                    v: signedMessage.v,
                    r: signedMessage.r,
                    s: signedMessage.s,
                    providerData: ethers.utils.hexlify(ethers.utils.toUtf8Bytes(providerData)),
                    validUntil: providerValidUntil
                },
                {
                    consumeMarketFeeAddress: consumeMarketFeeAddress,
                    consumeMarketFeeToken: consumeMarketFeeToken,
                    consumeMarketFeeAmount: consumeMarketFeeAmount,
                }
            );
        const txReceipt = await tx.wait();
        let event = getEventFromTx(txReceipt, 'OrderStarted')
        assert(event, "Cannot find OrderStarted event")
        event = getEventFromTx(txReceipt, 'PublishMarketFee')
        assert(event, "Cannot find PublishMarketFee event")
        event = getEventFromTx(txReceipt, 'ConsumeMarketFee')
        assert(event, "Cannot find ConsumeMarketFee event")
        //make sure that we have ProviderFee event
        event = getEventFromTx(txReceipt, 'ProviderFee')
        assert(
            (await erc20TokenWithPublishFee.balanceOf(user2.address)) == web3.utils.toWei("9"), 'Invalid user balance, DT was not substracted'
        );

        assert(
            (await erc20TokenWithPublishFee.balanceOf(opcCollector.address)) ==
            web3.utils.toWei("0.0"), 'Invalid OPF balance, we should get 0.03 DTs'
        );
        assert(
            (await erc20TokenWithPublishFee.balanceOf(user3.address)) == web3.utils.toWei("0"), 'Invalid consumeFee, we should have DT as fee'
        );
        assert(
            (await erc20TokenWithPublishFee.balanceOf(await erc20TokenWithPublishFee.getPaymentCollector())) ==
            web3.utils.toWei("0.0"), 'Invalid publisher reward, we should have 0.97 DT'
        );
    });

    it("#startOrder - user should succeed to call startOrder on a ERC20 with 5 USDC publishFee, providerFee is not ZEO", async () => {

        //MINT SOME DT20 to USER2 so he can start order
        await erc20TokenWithPublishFee.connect(user3).mint(user2.address, web3.utils.toWei("10"));
        assert(
            (await erc20TokenWithPublishFee.balanceOf(user2.address)) == web3.utils.toWei("10")
        );
        const consumer = user2.address; // could be different user
        const dtAmount = web3.utils.toWei("1");
        const serviceIndex = 1; // dummy index
        const providerFeeAddress = user5.address; // marketplace fee Collector
        const providerFeeAmount = '1'; // fee to be collected on top, requires approval
        const providerFeeToken = mockErc20.address; // token address for the feeAmount, in this case DAI
        const providerValidUntil = 0;
        const consumeMarketFeeAddress = user5.address; // marketplace fee Collector
        const consumeMarketFeeAmount = 0; // fee to be collected on top, requires approval
        const consumeMarketFeeToken = mockErc20.address; // token address for the feeAmount,
        // GET SOME providerFeeToken
        const Mock20Contract = await ethers.getContractAt(
            "contracts/interfaces/IERC20.sol:IERC20",
            providerFeeToken
        );
        await Mock20Contract
            .connect(owner)
            .transfer(user2.address, ethers.utils.parseEther(providerFeeAmount));
        await Mock20Contract
            .connect(user2)
            .approve(erc20TokenWithPublishFee.address, web3.utils.toWei(providerFeeAmount));

        const publishFee = await erc20TokenWithPublishFee
            .connect(user2)
            .getPublishingMarketFee();
        // GET SOME consumeFeeToken
        const Mock20DecimalContract = await ethers.getContractAt(
            "contracts/interfaces/IERC20.sol:IERC20",
            publishFee[1]
        );
        await Mock20DecimalContract
            .connect(owner)
            .transfer(user2.address, publishFee[2]);

        // we approve the erc20Token contract to pull feeAmount
        await Mock20DecimalContract
            .connect(user2)
            .approve(erc20TokenWithPublishFee.address, publishFee[2]);
        //sign provider data
        const providerData = JSON.stringify({ "timeout": 0 })
        const message = ethers.utils.solidityKeccak256(
            ["bytes", "address", "address", "uint256", "uint256"],
            [
                ethers.utils.hexlify(ethers.utils.toUtf8Bytes(providerData)),
                providerFeeAddress,
                providerFeeToken,
                providerFeeAmount,
                providerValidUntil
            ]
        );
        const signedMessage = await signMessage(message, providerFeeAddress);
        const tx = await erc20TokenWithPublishFee
            .connect(user2)
            .startOrder(
                consumer,
                serviceIndex,
                {
                    providerFeeAddress: providerFeeAddress,
                    providerFeeToken: providerFeeToken,
                    providerFeeAmount: providerFeeAmount,
                    v: signedMessage.v,
                    r: signedMessage.r,
                    s: signedMessage.s,
                    providerData: ethers.utils.hexlify(ethers.utils.toUtf8Bytes(providerData)),
                    validUntil: providerValidUntil
                },
                {
                    consumeMarketFeeAddress: consumeMarketFeeAddress,
                    consumeMarketFeeToken: consumeMarketFeeToken,
                    consumeMarketFeeAmount: consumeMarketFeeAmount,
                }
            );
        const txReceipt = await tx.wait();
        let event = getEventFromTx(txReceipt, 'OrderStarted')
        assert(event, "Cannot find OrderStarted event")
        event = getEventFromTx(txReceipt, 'PublishMarketFee')
        assert(event, "Cannot find PublishMarketFee event")
        //make sure that we have ProviderFee event
        event = getEventFromTx(txReceipt, 'ProviderFee')
        assert(
            (await erc20TokenWithPublishFee.balanceOf(user2.address)) == web3.utils.toWei("9"), 'Invalid user balance, DT was not substracted'
        );

        assert(
            (await erc20TokenWithPublishFee.balanceOf(opcCollector.address)) ==
            web3.utils.toWei("0.0"), 'Invalid OPF balance, we should get 0.03 DTs'
        );
        assert(
            (await erc20TokenWithPublishFee.balanceOf(user3.address)) == web3.utils.toWei("0"), 'Invalid consumeFee, we should have DT as fee'
        );
        assert(
            (await erc20TokenWithPublishFee.balanceOf(await erc20TokenWithPublishFee.getPaymentCollector())) ==
            web3.utils.toWei("0.0"), 'Invalid publisher reward, we should have 0.97 DT'
        );
    });


    it("#setPublishingMarketFee - user should not be able to set new publish fee", async () => {
        await expectRevert(
            erc20TokenWithPublishFee.connect(user2).setPublishingMarketFee(user2.address, erc20Token.address, web3.utils.toWei('10')),
            "ERC20Template: not publishMarketFeeAddress"
        );
        const publishFee = await erc20TokenWithPublishFee
            .connect(user2)
            .getPublishingMarketFee();
        assert(publishFee[0] = publishMarketFeeAddress)
        assert(publishFee[1] = publishMarketFeeToken)
        assert(publishFee[2] = web3.utils.toWei(publishMarketFeeAmount))
    });
    it("#setPublishingMarketFee - publishMarketAccount should not be able to set new publish fee", async () => {

        await erc20TokenWithPublishFee.connect(publishMarketAccount).setPublishingMarketFee(user2.address, erc20Token.address, web3.utils.toWei('10'))
        const publishFee = await erc20TokenWithPublishFee
            .connect(user2)
            .getPublishingMarketFee();
        assert(publishFee[0] = user2.address)
        assert(publishFee[1] = erc20Token.address)
        assert(publishFee[2] = web3.utils.toWei('10'))
    });
    it("#getId - should return templateId", async () => {
        const templateId = 3;
        assert((await erc20Token.getId()) == templateId);
    });
    it("#burn - user should succeed to burn tokens", async () => {

        //MINT SOME DT20 to USER2 so he can try to burn
        await erc20Token.connect(user3).mint(user2.address, web3.utils.toWei("10"));
        const burnAmount = web3.utils.toWei("2")
        assert(
            (await erc20Token.balanceOf(user2.address)) == web3.utils.toWei("10")
            , 'Invalid user balance, DT was not minted'
        );
        const totalSupply = await erc20Token.totalSupply()

        await erc20Token
            .connect(user2)
            .burn(burnAmount);


        assert(
            (await erc20Token.balanceOf(user2.address)) == web3.utils.toWei("8"), 'Invalid user balance, DT was not substracted'
        );
        const newTotalSupply = await erc20Token.totalSupply()
        const expectedSupply = totalSupply.sub(burnAmount)
        assert(
            (totalSupply.sub(burnAmount).eq(newTotalSupply))
            , 'Invalid total supply'
        );
    });
    it("#burnFrom - user3 should succeed to burn some user2's tokens using burnFrom", async () => {

        //MINT SOME DT20 to USER2 so he can try to burn
        await erc20Token.connect(user3).mint(user2.address, web3.utils.toWei("10"));
        const burnAmount = web3.utils.toWei("2")
        assert(
            (await erc20Token.balanceOf(user2.address)) == web3.utils.toWei("10")
            , 'Invalid user balance, DT was not minted'
        );
        const totalSupply = await erc20Token.totalSupply()
        //allow user3 to burn
        await erc20Token.connect(user2).approve(user3.address, web3.utils.toWei(burnAmount));
        await erc20Token
            .connect(user3)
            .burnFrom(user2.address, burnAmount);


        assert(
            (await erc20Token.balanceOf(user2.address)) == web3.utils.toWei("8"), 'Invalid user balance, DT were not burned'
        );
        const newTotalSupply = await erc20Token.totalSupply()
        const expectedSupply = totalSupply.sub(burnAmount)
        assert(
            (totalSupply.sub(burnAmount).eq(newTotalSupply))
            , 'Invalid total supply'
        );
    });

    // PREDICTOOR
    it("#blocks_per_epoch - blocks_per_epoch should be set", async () => {
        const blocksPerEpoch = await erc20Token.blocks_per_epoch();
        assert(blocksPerEpoch > 0, 'Invalid blocks_per_epoch');
    });
    it("#stake_tokens - stake token should be set", async () => {
        const stakeToken = await erc20Token.stake_token();
        assert(stakeToken == mockErc20.address, 'Invalid stake_token');
    });
    it("#blocks_per_subscription - blocks_per_subscription should be set", async () => {
        const blocksPerSubscription = await erc20Token.blocks_per_subscription();
        assert(blocksPerSubscription > 0, 'Invalid blocks_per_subscription');
    });
    it("#epoch, cur_epoch - should return currenct epoch", async () => {
        const blockNum = await ethers.provider.getBlockNumber();
        const blocksPerEpoch = (await erc20Token.blocks_per_epoch())
        const epoch = parseInt(blockNum / blocksPerEpoch);
        assert((await erc20Token.epoch(blockNum))) == epoch;
        assert((await erc20Token.cur_epoch())) == epoch;
    });
    it("#rail_blocknum_to_slot, blocknum_is_on_a_slot - should rail blocknum to slot", async () => {
        const blockNum = await ethers.provider.getBlockNumber();
        const blocksPerEpoch = (await erc20Token.blocks_per_epoch())
        const slot = parseInt(blockNum / blocksPerEpoch) * blocksPerEpoch;
        assert((await erc20Token.rail_blocknum_to_slot(blockNum)) == slot);
        const isOnSlot = await erc20Token.blocknum_is_on_a_slot(slot)
        assert(isOnSlot == true, isOnSlot +" should be true");
    });
    it("#soonest_block_to_predict - should return soonest block to predict", async () => {
        const soonestBlockToPredict = await erc20Token.soonest_block_to_predict();
        // this should be equal to
        // 1 + (currentBlock - 1) / 100
        const blocksPerEpoch = (await erc20Token.blocks_per_epoch())
        const blockNumber = await ethers.provider.getBlockNumber();
        const railed = parseInt(blockNumber / blocksPerEpoch) * blocksPerEpoch
        const expected = railed + blocksPerEpoch * (railed == blockNumber ? 1 : 2);
        assert(soonestBlockToPredict == expected, 'Invalid soonest block to predict');
    });
    it("#get_agg_predval - without subscription, should revert", async () => {
        const blockNumber = await ethers.provider.getBlockNumber()
        const blocksPerEpoch = (await erc20Token.blocks_per_epoch())
        const railed = parseInt(blockNumber / blocksPerEpoch) * blocksPerEpoch
        await expectRevert(
            erc20Token.get_agg_predval(railed),
            "No subscription"
        );
    });
    it("#get_agg_predval - without subscription, should revert", async () => {
        const blockNumber = await ethers.provider.getBlockNumber()
        const blocksPerEpoch = (await erc20Token.blocks_per_epoch())
        const railed = parseInt(blockNumber / blocksPerEpoch) * blocksPerEpoch
        await expectRevert(
            erc20Token.get_agg_predval(railed),
            "No subscription"
        );
    });
    it("#is_valid_subscription - without subscription, should return false", async () => {
        const isValidSubscription = await erc20Token.is_valid_subscription(erc20Token.address);
        assert(isValidSubscription == false, "Subscription must be invalid");
    });
    it("#submit_predval - predictoor submits predval", async () => {
        const predval = true;
        const stake = 100;
        await mockErc20.approve(erc20Token.address, stake);
        const soonestBlockToPredict = await erc20Token.soonest_block_to_predict();
        const predictionEpoch = await erc20Token.epoch(soonestBlockToPredict);

        const tx = await erc20Token.submit_predval(predval, stake, soonestBlockToPredict);
        const txReceipt = await tx.wait();
        const event = getEventFromTx(txReceipt, 'PredictionSubmitted')
        assert(event, "Cannot find PredictionSubmitted event")
        expect(event.event).to.equal("PredictionSubmitted");
        expect(event.args[0]).to.equal(owner.address);
        expect(event.args[1]).to.equal(predictionEpoch);
        expect(event.args[2]).to.equal(stake);
    });
    it("#submit_predval - predictoor can read their submitted predval", async () => {
        const predval = true;
        const stake = 100;
        await mockErc20.approve(erc20Token.address, stake);
        const soonestBlockToPredict = await erc20Token.soonest_block_to_predict();

        await erc20Token.submit_predval(predval, stake, soonestBlockToPredict);
        const prediction = await erc20Token.get_prediction(soonestBlockToPredict, owner.address);

        expect(prediction.predval).to.be.eq(predval);
        expect(prediction.stake).to.be.eq(stake);
        expect(prediction.predictoor).to.be.eq(owner.address);
        expect(prediction.paid).to.be.eq(false);
    });
    it("#submit_predval - others cannot read submitted predictions", async () => {
        const predval = true;
        const stake = 100;
        await mockErc20.approve(erc20Token.address, stake);
        const soonestBlockToPredict = await erc20Token.soonest_block_to_predict();

        await erc20Token.submit_predval(predval, stake, soonestBlockToPredict);
        expectRevert(erc20Token.connect(user2).get_prediction(soonestBlockToPredict, owner.address));
        // fast forward blocks until next epoch
        Array(30).fill(0).map(async _ => await ethers.provider.send("evm_mine"));
        // user2 should be able to read the predval now
        const prediction = await erc20Token.connect(user2).get_prediction(soonestBlockToPredict, owner.address);
        expect(prediction.predval).to.be.eq(predval);
    });
    it("#submit_predval - should revert when predictoor submits too early", async () => {
        const predval = true;
        const stake = 100;
        const block = await ethers.provider.getBlockNumber();
        const railed = await erc20Token.rail_blocknum_to_slot(block - 100);
        await mockErc20.approve(erc20Token.address, stake);

        await expectRevert(
            erc20Token.submit_predval(predval, stake, railed),
            "too late to submit"
        );
    });
    it("#submit_predval - should revert when predictoor submits duplicate prediction", async () => {
        const predval = true;
        const stake = 100;
        await mockErc20.approve(erc20Token.address, stake * 2);
        const soonestBlockToPredict = await erc20Token.soonest_block_to_predict();

        await erc20Token.submit_predval(predval, stake, soonestBlockToPredict);

        await expectRevert(
            erc20Token.submit_predval(predval, stake, soonestBlockToPredict),
            "already submitted"
        );
    });
    it("#pause_predictions - should pause and resume predictions", async () => {
        await erc20Token.pause_predictions();
        const isPaused = await erc20Token.paused();
        assert(isPaused == true, "Predictions should be paused");

        // submit predval should revert
        const predval = true;
        const stake = 100;
        await mockErc20.approve(erc20Token.address, stake);
        const soonestBlockToPredict = await erc20Token.soonest_block_to_predict();
        await expectRevert(
            erc20Token.submit_predval(predval, stake, soonestBlockToPredict),
            "paused"
        );

        await erc20Token.pause_predictions();
        const isResumed = await erc20Token.paused();
        assert(isResumed == false, "Predictions should be resumed");
    });

    it("#update_seconds - should revert when seconds per subscription is not divisible by seconds per block", async () => {
        const s_per_block = 3;
        const s_per_subscription = 10;
        const _truval_submit_timeout = 30;

        await expectRevert(
            erc20Token.update_seconds(s_per_block, s_per_subscription, _truval_submit_timeout),
            "%"
        );
    });

    it("#subscriptions - user2 must be subscribed", async () => {
        //MINT SOME DT20 to USER2 so he can start order
        await erc20Token.connect(user3).mint(user2.address, web3.utils.toWei("10"));
        assert(
            (await erc20Token.balanceOf(user2.address)) == web3.utils.toWei("10")
        );
        const consumer = user2.address; // could be different user
        const serviceIndex = 1; // dummy index
        const providerFeeAddress = user5.address; // marketplace fee Collector
        const providerFeeAmount = 0; // fee to be collected on top, requires approval
        const providerFeeToken = mockErc20.address; // token address for the feeAmount,
        const consumeMarketFeeAddress = user5.address; // marketplace fee Collector
        const consumeMarketFeeAmount = 0; // fee to be collected on top, requires approval
        const consumeMarketFeeToken = mockErc20.address; // token address for the feeAmount,
        const providerValidUntil = 0;
        //sign provider data
        const providerData = JSON.stringify({ "timeout": 0 })
        const message = ethers.utils.solidityKeccak256(
            ["bytes", "address", "address", "uint256", "uint256"],
            [
                ethers.utils.hexlify(ethers.utils.toUtf8Bytes(providerData)),
                providerFeeAddress,
                providerFeeToken,
                providerFeeAmount,
                providerValidUntil
            ]
        );
        const signedMessage = await signMessage(message, providerFeeAddress);
        const tx = await erc20Token
            .connect(user2)
            .startOrder(
                consumer,
                serviceIndex,
                {
                    providerFeeAddress: providerFeeAddress,
                    providerFeeToken: providerFeeToken,
                    providerFeeAmount: providerFeeAmount,
                    v: signedMessage.v,
                    r: signedMessage.r,
                    s: signedMessage.s,
                    providerData: ethers.utils.hexlify(ethers.utils.toUtf8Bytes(providerData)),
                    validUntil: providerValidUntil
                },
                {
                    consumeMarketFeeAddress: consumeMarketFeeAddress,
                    consumeMarketFeeToken: consumeMarketFeeToken,
                    consumeMarketFeeAmount: consumeMarketFeeAmount,
                }
            );


        const subscription = await erc20Token.subscriptions(user2.address);
        // check if subscription is valid
        const currentBlock = await ethers.provider.getBlockNumber();
        expect(subscription.expires).to.be.gt(currentBlock);
        expect(subscription.user).to.be.eq(user2.address);
    });


    // can read get_agg_predval with a valid subscription
    it("#get_agg_predval - should return agg_predval if caller has a valid subscription", async () => {
        //MINT SOME DT20 to USER2 so he can start order
        await erc20Token.connect(user3).mint(user2.address, web3.utils.toWei("10"));
        assert(
            (await erc20Token.balanceOf(user2.address)) == web3.utils.toWei("10")
        );
        const consumer = user2.address; // could be different user
        const serviceIndex = 1; // dummy index
        const providerFeeAddress = user5.address; // marketplace fee Collector
        const providerFeeAmount = 0; // fee to be collected on top, requires approval
        const providerFeeToken = mockErc20.address; // token address for the feeAmount,
        const consumeMarketFeeAddress = user5.address; // marketplace fee Collector
        const consumeMarketFeeAmount = 0; // fee to be collected on top, requires approval
        const consumeMarketFeeToken = mockErc20.address; // token address for the feeAmount,
        const providerValidUntil = 0;
        //sign provider data
        const providerData = JSON.stringify({ "timeout": 0 })
        const message = ethers.utils.solidityKeccak256(
            ["bytes", "address", "address", "uint256", "uint256"],
            [
                ethers.utils.hexlify(ethers.utils.toUtf8Bytes(providerData)),
                providerFeeAddress,
                providerFeeToken,
                providerFeeAmount,
                providerValidUntil
            ]
        );
        const signedMessage = await signMessage(message, providerFeeAddress);
        await erc20Token
            .connect(user2)
            .startOrder(
                consumer,
                serviceIndex,
                {
                    providerFeeAddress: providerFeeAddress,
                    providerFeeToken: providerFeeToken,
                    providerFeeAmount: providerFeeAmount,
                    v: signedMessage.v,
                    r: signedMessage.r,
                    s: signedMessage.s,
                    providerData: ethers.utils.hexlify(ethers.utils.toUtf8Bytes(providerData)),
                    validUntil: providerValidUntil
                },
                {
                    consumeMarketFeeAddress: consumeMarketFeeAddress,
                    consumeMarketFeeToken: consumeMarketFeeToken,
                    consumeMarketFeeAmount: consumeMarketFeeAmount,
                }
            );


        let soonestBlockToPredict = await erc20Token.soonest_block_to_predict();
        const [numer, denom] = await erc20Token.connect(user2).get_agg_predval(soonestBlockToPredict);
        expect(numer).to.be.eq(0);
        expect(denom).to.be.eq(0);

        // user2 makes a prediction
        const predval = true;
        const stake = web3.utils.toWei("1");
        await mockErc20.transfer(user3.address, stake);
        await mockErc20.connect(user3).approve(erc20Token.address, stake);
        soonestBlockToPredict = await erc20Token.soonest_block_to_predict();
        await erc20Token.connect(user3).submit_predval(predval, stake, soonestBlockToPredict);

        soonestBlockToPredict = await erc20Token.soonest_block_to_predict();
        const [numer2, denom2] = await erc20Token.connect(user2).get_agg_predval(soonestBlockToPredict);
        expect(numer2).to.be.eq(web3.utils.toWei("1"));
        expect(denom2).to.be.eq(web3.utils.toWei("1"));

        // check subscription revenue
        const revenue = await erc20Token.get_subscription_revenue_at_block(soonestBlockToPredict);
        expect(revenue).to.be.eq(0);
    });

    // can read get_agg_predval with a valid subscription
    it("predictoor gets paid", async () => {
        const consumer = user2.address; // could be different user
        const serviceIndex = 1; // dummy index
        const providerFeeAddress = user5.address; // marketplace fee Collector
        const providerFeeAmount = 0; // fee to be collected on top, requires approval
        const providerFeeToken = mockErc20.address; // token address for the feeAmount,
        const consumeMarketFeeAddress = user5.address; // marketplace fee Collector
        const consumeMarketFeeAmount = 0; // fee to be collected on top, requires approval
        const consumeMarketFeeToken = mockErc20.address; // token address for the feeAmount,
        const providerValidUntil = 0;
        const marketFee = 1e15 // 0.1%
        const marketFeeCollector = addressZero
        const rate = web3.utils.toWei("2"); // 2 tokens per dt
        const amountDT = web3.utils.toWei("1");

        //create fixed rate
        const tx = await erc20Token.connect(owner).createFixedRate(
            fixedRateExchange.address,
            [mockErc20.address, owner.address, marketFeeCollector, addressZero],
            [18, 18, rate, marketFee, 1])
        const txReceipt = await tx.wait();
        let event = getEventFromTx(txReceipt, 'NewFixedRate')
        assert(event, "Cannot find NewFixedRate event")
        exchangeId = event.args.exchangeId
        const exchangeInfo = await fixedRateExchange.calcBaseInGivenOutDT(exchangeId, amountDT, 0)

        //let's buy a DT
        await mockErc20.transfer(user2.address, exchangeInfo.baseTokenAmount);
        await mockErc20.connect(user2).approve(fixedRateExchange.address, exchangeInfo.baseTokenAmount);
        // user buys DT
        await fixedRateExchange.connect(user2).buyDT(exchangeId, amountDT, exchangeInfo.baseTokenAmount, addressZero, 0)
        const balance = await erc20Token.balanceOf(user2.address)
        assert(balance > 0, "Failed to buy DT")
        //sign provider data
        const providerData = JSON.stringify({ "timeout": 0 })
        const message = ethers.utils.solidityKeccak256(
            ["bytes", "address", "address", "uint256", "uint256"],
            [
                ethers.utils.hexlify(ethers.utils.toUtf8Bytes(providerData)),
                providerFeeAddress,
                providerFeeToken,
                providerFeeAmount,
                providerValidUntil
            ]
        );
        const signedMessage = await signMessage(message, providerFeeAddress);
        let soonestBlockToPredict = await erc20Token.soonest_block_to_predict();
        let revenue_at_block = await erc20Token.connect(user2).get_subscription_revenue_at_block(soonestBlockToPredict)
        expect(revenue_at_block).to.be.eq(0);

        await erc20Token
            .connect(user2)
            .startOrder(
                consumer,
                serviceIndex,
                {
                    providerFeeAddress: providerFeeAddress,
                    providerFeeToken: providerFeeToken,
                    providerFeeAmount: providerFeeAmount,
                    v: signedMessage.v,
                    r: signedMessage.r,
                    s: signedMessage.s,
                    providerData: ethers.utils.hexlify(ethers.utils.toUtf8Bytes(providerData)),
                    validUntil: providerValidUntil
                },
                {
                    consumeMarketFeeAddress: consumeMarketFeeAddress,
                    consumeMarketFeeToken: consumeMarketFeeToken,
                    consumeMarketFeeAmount: consumeMarketFeeAmount,
                }
            );

        revenue_at_block = await erc20Token.connect(user2).get_subscription_revenue_at_block(soonestBlockToPredict)
        expect(revenue_at_block).to.be.gt(0);

        // predictoor makes a prediction
        const predval = true;
        const stake = web3.utils.toWei("1");
        await mockErc20.transfer(user3.address, stake);
        await mockErc20.connect(user3).approve(erc20Token.address, stake);
        await erc20Token.connect(user3).submit_predval(predval, stake, soonestBlockToPredict);

        await expectRevert(erc20Token.connect(user3).payout(soonestBlockToPredict, user3.address), "trueval not submitted")
        Array(30).fill(0).map(async _ => await ethers.provider.send("evm_mine"));
        await expectRevert(erc20Token.connect(user3).payout(soonestBlockToPredict, user3.address), "trueval not submitted");

        // opf submits truval
        await erc20Token.submit_trueval(soonestBlockToPredict, predval);
        const balBefore = await mockErc20.balanceOf(user3.address);
        await erc20Token.connect(user3).payout(soonestBlockToPredict, user3.address);
        const balAfter = await mockErc20.balanceOf(user3.address);
        expect(balAfter).to.be.gt(balBefore);

        const profit = balAfter.sub(balBefore);
        const expectedProfit = 1 + (2 / parseInt(3600 / parseInt(300 / 24)))
        expect(parseFloat(web3.utils.fromWei(profit.toString()))).to.be.eq(expectedProfit);

        await expectRevert(erc20Token.connect(user3).payout(soonestBlockToPredict, user3.address), "already paid");
    });

    it("multiple predictoor compete and some gets paid", async () => {
        // predictoor makes a predictions
        let predictoors = [reciever, user2, user3, user4, user5, user6];
        let predictions = [];
        let stakes = [];
        for(const predictoor of predictoors){
            const amt = web3.utils.toWei("200");
            await mockErc20.transfer(predictoor.address, amt);
            await mockErc20.connect(predictoor).approve(erc20Token.address, amt);
        }
        
        const blocksPerEpoch = await erc20Token.blocks_per_epoch();
        const currentBlock = await ethers.provider.getBlockNumber();
        const soonestBlockToPredict = await erc20Token.soonest_block_to_predict();
        Array(soonestBlockToPredict - currentBlock + 1).fill(0).map(async _ => await ethers.provider.send("evm_mine"));
        const predictionBlock = await erc20Token.soonest_block_to_predict();
        
        for(const predictoor of predictoors){
            const stake = 10 + Math.random() * 100;
            const stakeWei = web3.utils.toWei(stake.toString());
            const p = Math.random() > 0.5;
            predictions.push(p);
            stakes.push(stake);
            await erc20Token.connect(predictoor).submit_predval(p, stakeWei, predictionBlock)
        }
        
        Array(blocksPerEpoch * 2).fill(0).map(async _ => await ethers.provider.send("evm_mine"));
        const truval = Math.random() > 0.5;
        const winners = predictions.map((x,i)=>x==truval?i:null).filter(x=>x!=null);
        const totalStake = stakes.reduce((a,b)=>a+b, 0);
        const winnersStake = winners.map(x=>stakes[x]).reduce((a,b)=>a+b, 0);

        // opf submits truval
        await erc20Token.submit_trueval(predictionBlock, truval);

        // each predictoor calls payout function
        for (let i = 0; i < predictoors.length; i++){
            let predictoor = predictoors[i];
            if (winners.includes(i)) {
                const balBefore = await mockErc20.balanceOf(predictoor.address);
                await erc20Token.connect(predictoor).payout(predictionBlock, predictoor.address);
                const balAfter = await mockErc20.balanceOf(predictoor.address);
                expect(balAfter).to.be.gt(balBefore);
                const profit = balAfter.sub(balBefore);
                const expectedProfitSub = (2 / parseInt(3600 / parseInt(300 / 24)))
                const expectedProfitStake = stakes[i] / winnersStake * totalStake
                const expectedProfit = expectedProfitSub + expectedProfitStake
                expect(parseFloat(web3.utils.fromWei(profit.toString()))).to.be.closeTo(expectedProfit, 0.2);
            } else {
                await expectRevert(erc20Token.connect(predictoor).payout(predictionBlock, predictoor.address), "wrong prediction");
            }
        }

    });
});
