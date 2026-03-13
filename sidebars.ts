import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  specSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Knowledge Base',
      items: [
        'cardano/research',
        'cardano/eras',
        'cardano/node-architecture',
        'cardano/ledger-specs',
        'cardano/networking',
        'cardano/current-state',
      ],
    },
    {
      type: 'category',
      label: 'Specification',
      items: [
        'spec/notation',
        'spec/crypto',
        'spec/data-types',
        'spec/serialization',
        'spec/ledger-state',
        'spec/transactions',
        'spec/scripts',
        'spec/certificates',
        'spec/epoch',
        'spec/rewards',
        'spec/consensus',
        'spec/governance',
        'spec/networking',
        'spec/storage',
      ],
    },
    {
      type: 'category',
      label: 'BlueMatter',
      items: [
        'architecture/overview',
        'architecture/call-flows',
        'architecture/codec',
        'architecture/crypto',
        'architecture/consensus',
        'architecture/ledger',
        'architecture/network',
        'architecture/node',
      ],
    },
  ],
};

export default sidebars;
