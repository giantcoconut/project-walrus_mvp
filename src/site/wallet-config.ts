import { getDefaultConfig, type WalletList } from '@rainbow-me/rainbowkit';
import {
  backpackWallet,
  injectedWallet,
  magicEdenWallet,
  metaMaskWallet,
  phantomWallet,
  rabbyWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';

import { INTUITION_CHAINS } from '../intuition/public';

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || 'aletheia-public-wallet';

const wallets: WalletList = [
  {
    groupName: 'Installed',
    wallets: [rabbyWallet, phantomWallet, metaMaskWallet, backpackWallet, magicEdenWallet, injectedWallet],
  },
  ...(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim()
    ? [
        {
          groupName: 'Connect',
          wallets: [walletConnectWallet],
        },
      ]
    : []),
];

export const walletConfig: ReturnType<typeof getDefaultConfig> = getDefaultConfig({
  appName: 'Aletheia Terminal',
  appDescription: 'Create atoms, publish claims, and work with the Intuition protocol.',
  appUrl: 'https://aletheia.local',
  projectId: walletConnectProjectId,
  chains: [INTUITION_CHAINS.testnet, INTUITION_CHAINS.mainnet],
  wallets,
  ssr: true,
});
