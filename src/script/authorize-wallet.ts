import { ethers } from 'ethers';

async function authorizeLiquidator() {
  // 1. Setup provider and signer
  const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  const adminSigner = new ethers.Wallet(
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    provider,
  );

  const contractAddress = '0x6D544390Eb535d61e196c87d6B9c80dCD8628Acd';
  const backendWallet = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';

  // 2. Define the ABI for Ownable (transferOwnership)
  const abi = ['function transferOwnership(address newOwner)'];
  const contract = new ethers.Contract(contractAddress, abi, adminSigner);

  console.log(`Transferring ownership to ${backendWallet}...`);

  // 3. Execute transferOwnership
  const tx = await contract.transferOwnership(backendWallet);
  await tx.wait();

  console.log('Success! Backend wallet is now the Owner of the contract.');
}

authorizeLiquidator().catch(console.error);
