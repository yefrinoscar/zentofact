declare module 'strong-soap' {
  export const soap: {
    createClientAsync: (wsdl: string) => Promise<any>;
    Client: any;
  };
}

declare module 'node-forge' {
  const forge: any;
  export default forge;
}
