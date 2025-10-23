import React, { FunctionComponent, useState, useEffect } from 'react';
import { Button, ButtonVariant } from '../ui/button';
import { LoadingOverlay } from '../ui/loading';
import { Alert } from '../ui/alert';
import { TranslatedString } from '@bigcommerce/checkout/locale';
import { useCheckout } from "@bigcommerce/checkout/payment-integration-api";
//import '../styles/tailwind.css';
import {
    Cart,
    Country,
    Customer,
    ConsignmentAssignmentRequestBody,
    CheckoutSelectors,
    Address
} from '@bigcommerce/checkout-sdk';

import {
    saveConsignmentToSession,
    updateStoredConsignment,
    removeStoredConsignment,
    findStoredConsignmentByLineItemId
} from './consignment-persistence';

import { AddressFormModal, AddressFormValues, AddressSelect, AddressType, mapAddressFromFormValues, isValidAddress } from "../address";
import GiftMessageModal from "./GiftMessageModal"
import { ErrorModal } from '../common/error';
import DeliveryDateModal from './DeliveryDateModal';
//import getRecommendedShippingOption from './getRecommendedShippingOption';

// Creating a custom error class similar to ConsignmentAddressSelector
class InvalidAddressError extends Error {
    constructor() {
        super('The address is invalid');
        this.name = 'InvalidAddressError';
    }
}

export interface LineItem {
    id: string | number;
    name: string;
    imageUrl?: string;
    sku: string;
    quantity: number;
    giftWrapping?: {
        name?: string;
        message?: string;
        amount?: number;
    };
}

export interface ConsignmentWithItem {
    id?: string;
    lineItemId: string | number;
    shippingAddress?: any;
    selectedShippingOption?: any;
    availableShippingOptions?: any[];
}

export interface CustomShippingProps {
    isBillingSameAsShipping: boolean;
    cartHasChanged: boolean;
    isMultiShippingMode: boolean;
    step: {
        isActive: boolean;
        isComplete: boolean;
        isBusy: boolean;
    };
    cart: Cart;
    consignments: any[];
    customer: Customer;
    countries: Country[];
    countriesWithAutocomplete?: string[];
    googleMapsApiKey?: string;
    isFloatingLabelEnabled?: boolean;
    shippingAddress?: any;
    navigateNextStep(isBillingSameAsShipping: boolean): void;
    onCreateAccount(): void;
    onReady?(): void;
    onSignIn(): void;
    onToggleMultiShipping(): void;
    onUnhandledError(error: Error): void;
    assignItem(consignment: ConsignmentAssignmentRequestBody): Promise<CheckoutSelectors>;
    updateBillingAddress?: (address: any) => Promise<any>;
    getFields?: (countryCode?: string) => any[];
    loadShippingOptions?: () => Promise<any>;
    deleteConsignments?: () => Promise<any>;
    selectShippingOption?: (consignmentId: string, shippingOptionId: string) => Promise<CheckoutSelectors>;
}

// Main component function with initialization explanation
const CustomShipping: FunctionComponent<CustomShippingProps> = ({
    cart,
    navigateNextStep,
    isBillingSameAsShipping,
    consignments,
    customer,
    countries,
    onReady = () => { },
    onUnhandledError,
    getFields,
    countriesWithAutocomplete = ['US', 'CA', 'AU', 'NZ', 'GB'],
    googleMapsApiKey = '',
    isFloatingLabelEnabled,
}) => {

    const filteredCountries = countries.filter(country => country.code === 'US');

    // Component services and hooks
    const {
        checkoutService: {
            createCustomerAddress,
            loadCheckout,
        },
        checkoutState: {
            data: {
                getCheckout,
            },
        },
    } = useCheckout();

    // ---------- STATE MANAGEMENT ----------
    // UI state flags
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingDates, setIsLoadingDates] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [currentItemIndex, setCurrentItemIndex] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [isInitializing, setIsInitializing] = useState(true);


    // Shipping configuration state
    const [selectedAddress, setSelectedAddress] = useState<any>(null);
    const [selectedShippingOption, setSelectedShippingOption] = useState<any>(null);
    const [itemConsignments, setItemConsignments] = useState<ConsignmentWithItem[]>([]);
    const [isAddAddressModalOpen, setIsAddAddressModalOpen] = useState(false);
    const [configuredItems, setConfiguredItems] = useState<{ [key: string]: boolean }>({});
    const [allItemsConfigured, setAllItemsConfigured] = useState(false);
    const [createCustomerAddressError, setCreateCustomerAddressError] = useState<Error | undefined>();

    const [itemGuestAddresses, setItemGuestAddresses] = useState<{ [key: string]: any }>({});
    const [isEditingGuestAddress, setIsEditingGuestAddress] = useState(false);

    // Add originalItemOrder state to maintain the display order
    const [originalItemOrder, setOriginalItemOrder] = useState<string[]>([]);

    const [isEditGiftMessageModalOpen, setIsEditGiftMessageModalOpen] = useState(false);
    const [currentGiftMessageItemId, setCurrentGiftMessageItemId] = useState<string | number | null>(null);
    const [editedGiftMessage, setEditedGiftMessage] = useState('');

    //const [availableShippingDates, setAvailableShippingDates] = useState<Date[]>([]);
    const [selectedShippingDate, setSelectedShippingDate] = useState<Date | null>(null);
    const [selectedDeliveryDate, setSelectedDeliveryDate] = useState<Date | null>(null);
    const [cartItems, setCartItems] = useState<any[]>([]);

    const [isDeliveryDateModalOpen, setIsDeliveryDateModalOpen] = useState(false);
    const physicalItems = cart.lineItems.physicalItems;

    const getOrderedPhysicalItems = () => {
        // Make a copy of the physical items
        const itemsToOrder = [...physicalItems];

        // Sort the items based on the originalItemOrder array
        return itemsToOrder.sort((a, b) => {
            const aIndex = originalItemOrder.indexOf(a.id.toString());
            const bIndex = originalItemOrder.indexOf(b.id.toString());

            // If both items are in the original order, sort by their position
            if (aIndex !== -1 && bIndex !== -1) {
                return aIndex - bIndex;
            }

            // If only one item is in the original order, prioritize it
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;

            // If neither item is in the original order (shouldn't happen),
            // preserve their current order
            return 0;
        });
    };

    // ---------- API INTERACTION FUNCTIONS ----------
    // Fetch cart data from the BigCommerce API
    const fetchCartData = async () => {
        const options = {
            method: 'GET',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
        };

        try {
            const response = await fetch('/api/storefront/carts?include=lineItems.physicalItems.options', options);
            if (!response.ok) {
                throw new Error('Failed to fetch cart data');
            }

            const cartData = await response.json();
            if (cartData && cartData.length > 0 && cartData[0].lineItems) {
                const physicalItemsWithOptions = cartData[0].lineItems.physicalItems || [];
                setCartItems(physicalItemsWithOptions);

                // Fetch and store product options for missing products
                await fetchAndStoreProductOptions(physicalItems);

                return physicalItemsWithOptions; // Return the data
            }
            return [];
        } catch (err) {
            console.error('Error fetching cart data:', err);
            return [];
        }
    };

    const fetchPhysicalItems = async () => {
        const options = {
            method: 'GET',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
        };

        const response = await fetch('/api/storefront/carts?include=lineItems.physicalItems.options', options);
        if (!response.ok) {
            throw new Error('Failed to fetch cart data');
        }

        const cartData = await response.json();

        return cartData[0].lineItems.physicalItems || [];
    }

    const fetchAndStoreProductOptions = async (physicalItems: any[]) => {
        try {
            // Get all product IDs from physical items
            const productIds = physicalItems.map((item: { productId: { toString: () => any; }; }) => item.productId.toString());

            // Check which product IDs are missing from session
            const missingProductIds = productIds.filter((productId: any) => {
                const sessionKey = productId;
                return !sessionStorage.getItem(sessionKey);
            });

            // If there are missing product IDs, fetch them
            if (missingProductIds.length > 0) {
                const requestBody = {
                    itemId: missingProductIds
                };

                const response = await fetch('https://bc-middleware-mm.onrender.com/cart/get-options', {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch product options');
                }

                const productOptions = await response.json();

                // Store each product's options in session with productId as key
                Object.keys(productOptions).forEach(productId => {
                    const sessionKey = productId;
                    sessionStorage.setItem(sessionKey, JSON.stringify(productOptions[productId]));
                });

                console.log(`Stored options for ${Object.keys(productOptions).length} products in session`);
            }
        } catch (error) {
            console.error('Error fetching and storing product options:', error);
        }
    };

    const hasValidOptionValue = async (itemId: string | number, optionName: string) => {
        let cartItem: any;
        if (cartItems && cartItems.length === 0) {
            const items = await fetchPhysicalItems();
            cartItem = items.find((item: any) => item.id == itemId);
        } else {
            cartItem = cartItems.find(item => item.id == itemId);
        }
        if (!cartItem || !cartItem.options || !Array.isArray(cartItem.options)) {
            return false;
        }

        const deliveryDateOption = cartItem.options.find((option: any) =>
            option.name === optionName || option.name.includes(optionName)
        );

        // If there's no delivery date option, we don't need to check it
        if (!deliveryDateOption) {
            return true;
        }

        // Check if the delivery date has a value that's not empty
        return deliveryDateOption.value && deliveryDateOption.value.trim() !== '';
    };

    const getItemDeliveryDate = async (itemId: string | number): Promise<string | null> => {
        let cartItem: any;
        if (cartItems && cartItems.length === 0) {
            const items = await fetchPhysicalItems();
            cartItem = items.find((item: any) => item.id == itemId);
        } else {
            cartItem = cartItems.find(item => item.id == itemId);
        }

        if (!cartItem || !cartItem.options || !Array.isArray(cartItem.options)) {
            return null;
        }

        const deliveryDateOption = cartItem.options.find((option: any) =>
            option.name === "Delivery Date" || option.name.includes("Delivery Date")
        );

        return deliveryDateOption?.value || null;
    };

    const getItemShippingDate = async (itemId: string | number): Promise<string | null> => {
        let cartItem: any;
        if (cartItems && cartItems.length === 0) {
            const items = await fetchPhysicalItems();
            cartItem = items.find((item: any) => item.id == itemId);
        } else {
            cartItem = cartItems.find(item => item.id == itemId);
        }

        if (!cartItem || !cartItem.options || !Array.isArray(cartItem.options)) {
            return null;
        }

        const deliveryDateOption = cartItem.options.find((option: any) =>
            option.name === "Ship Date" || option.name.includes("Ship Date")
        );

        return deliveryDateOption?.value || null;
    };




    const clearDeliveryDateForItem = async (checkoutId: string, lineItemId: { toString: () => any; }) => {
        try {
            // Fetch cart data with options
            const options = {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                }
            };

            const response = await fetch('/api/storefront/carts?include=lineItems.physicalItems.options', options);

            if (!response.ok) {
                throw new Error('Failed to fetch cart data');
            }

            const cartData = await response.json();
            if (!cartData || !cartData.length || !cartData[0].lineItems) {
                console.log('No cart data found');
                return false;
            }

            // Find the specific item
            const cartItem = cartData[0].lineItems.physicalItems.find(
                (item: { id: { toString: () => any; }; }) => item.id.toString() === lineItemId.toString()
            );

            if (!cartItem || !cartItem.options || !Array.isArray(cartItem.options)) {
                console.log(`No valid cart item or options found for ${lineItemId}`);
                return false;
            }

            // Look for a delivery date option
            const deliveryDateOption = cartItem.options.find((option: { name: string | string[]; }) =>
                option.name === "Delivery Date" || option.name.includes("Delivery Date")
            );
            if (!deliveryDateOption || !deliveryDateOption.nameId) {
                console.log(`No delivery date option found for item ${lineItemId}`);
                return false;
            }

            // Build option selections array preserving all existing options
            const optionSelections = cartItem.options.map((option: { nameId: any; value: any; valueId: any; }) => ({
                optionId: option.nameId,
                optionValue: option.valueId || option.value
            }));

            // Find and update the delivery date option to empty string
            const deliveryDateIndex = optionSelections.findIndex(
                (option: { optionId: any; }) => option.optionId === deliveryDateOption.nameId
            );

            if (deliveryDateIndex >= 0) {
                // Clear the delivery date value while preserving the option
                optionSelections[deliveryDateIndex].optionValue = "";
            }

            // Clear the delivery date while preserving all other options
            const updateOptions = {
                method: 'PUT',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    lineItem: {
                        productId: cartItem.productId,
                        variantId: cartItem.variantId,
                        quantity: cartItem.quantity,
                        optionSelections: optionSelections
                    }
                })
            };

            const updateResponse = await fetch(`/api/storefront/carts/${checkoutId}/items/${lineItemId}`, updateOptions);

            if (!updateResponse.ok) {
                throw new Error(`Failed to update delivery date for item ${lineItemId}`);
            }

            console.log(`Cleared delivery date for item ${lineItemId}`);
            return true;
        } catch (error) {
            console.error(`Error clearing delivery date for item ${lineItemId}:`, error);
            return false;
        }
    };

    // ---------- INITIALIZATION & DATA LOADING ---------
    useEffect(() => {
        fetchCartData();
    }, []);

    useEffect(() => {
        if (error) {
            const errorTimeout = setTimeout(() => {
                setError(null);
            }, 7000); // 7 seconds

            // Cleanup function to clear the timeout if component unmounts
            return () => clearTimeout(errorTimeout);
        }
    }, [error]);

    useEffect(() => {
        const checkout = getCheckout();
        const isGuest = !checkout || !checkout.customer || checkout.customer.id === 0;

        if (isGuest) {
            // Load all item-specific guest addresses
            const itemAddresses: { [key: string]: any } = {};

            physicalItems.forEach(item => {
                const storageKey = `guestAddress_${item.id}`;
                const storedAddress = localStorage.getItem(storageKey);
                if (storedAddress) {
                    try {
                        itemAddresses[item.id.toString()] = JSON.parse(storedAddress);
                    } catch (error) {
                        console.error(`Error parsing guest address for item ${item.id}:`, error);
                    }
                }
            });

            setItemGuestAddresses(itemAddresses);
        }
    }, [physicalItems]);

    // First initialization - only remove consignments that have multiple items
    // Initialize consignments and split items if needed

    useEffect(() => {
        const initConsignments = async () => {
            if (physicalItems.length > 0) {
                setIsInitializing(true);
                setIsLoading(true);
                try {
                    // Combined fetch for cart and checkout data
                    const checkout = getCheckout();
                    if (!checkout) {
                        return;
                    }

                    // SINGLE FETCH: Get all data in one request
                    const checkoutResponse = await fetch(
                        `/api/storefront/checkouts/${checkout.id}?include=consignments.availableShippingOptions,cart.lineItems.physicalItems.options`,
                        {
                            method: 'GET',
                            headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
                        }
                    );

                    if (!checkoutResponse.ok) {
                        throw new Error('Failed to fetch checkout data');
                    }

                    const checkoutData = await checkoutResponse.json();

                    // Extract cart items from checkout response (avoiding separate fetchCartData call)
                    const cartItemsWithOptions = checkoutData.cart?.lineItems?.physicalItems || [];
                    setCartItems(cartItemsWithOptions);

                    const itemOrder = physicalItems.map(item => item.id.toString());
                    setOriginalItemOrder(itemOrder);

                    let currentConsignments = checkoutData.consignments || [];

                    // Helper function to validate consignment for delivery
                    const isConsignmentValidForDelivery = (consignment: { selectedShippingOption: any; lineItemIds: any; }) => {
                        if (!consignment.selectedShippingOption) {
                            return false;
                        }

                        const lineItemIds = Array.isArray(consignment.lineItemIds)
                            ? consignment.lineItemIds
                            : [consignment.lineItemIds];

                        return lineItemIds.every((lineItemId: string | number) => {
                            const cartItem = cartItemsWithOptions.find((item: any) => item.id == lineItemId);

                            if (!cartItem || !cartItem.options || !Array.isArray(cartItem.options)) {
                                return false;
                            }

                            const deliveryDateOption = cartItem.options.find((option: any) =>
                                option.name === "Delivery Date" || option.name.includes("Delivery Date")
                            );

                            if (!deliveryDateOption) {
                                return true;
                            }

                            if (!deliveryDateOption.value || deliveryDateOption.value.trim() === '') {
                                return false;
                            }

                            try {
                                const currentDate = new Date();
                                const itemDeliveryDate = new Date(deliveryDateOption.value);
                                return itemDeliveryDate > currentDate;
                            } catch (error) {
                                return false;
                            }
                        });
                    };

                    // Find consignments with multiple items
                    const multiItemConsignments = currentConsignments.filter(
                        (consignment: { lineItemIds: string | any[]; }) => consignment.lineItemIds && consignment.lineItemIds.length > 1
                    );

                    // Process multi-item consignments to preserve configured items
                    if (multiItemConsignments.length > 0) {
                        console.log('Found multi-item consignments, processing...');

                        // Track which items need restoration
                        const itemsToRestore: { lineItemId: string; storedConsignment: any }[] = [];

                        // OPTIMIZATION: Batch process multi-item consignments
                        for (const multiConsignment of multiItemConsignments) {
                            const lineItemIds = Array.isArray(multiConsignment.lineItemIds)
                                ? multiConsignment.lineItemIds
                                : [multiConsignment.lineItemIds];

                            // Check each item in the multi-item consignment
                            for (const lineItemId of lineItemIds) {
                                const physicalItem = physicalItems.find(
                                    item => item.id.toString() === lineItemId.toString()
                                );

                                if (physicalItem) {
                                    // Check if this item has a stored consignment
                                    const storedConsignment = findStoredConsignmentByLineItemId(
                                        lineItemId,
                                        physicalItem.quantity
                                    );

                                    // If we have a stored consignment with shipping option, mark it for restoration
                                    if (storedConsignment?.selectedShippingOptionId) {
                                        itemsToRestore.push({ lineItemId, storedConsignment });
                                    }
                                }
                            }

                            // Delete the multi-item consignment
                            const deleteOptions = {
                                method: 'DELETE',
                                headers: {
                                    'Accept': 'application/json'
                                }
                            };

                            await fetch(`/api/storefront/checkouts/${checkout.id}/consignments/${multiConsignment.id}`, deleteOptions);

                            // Remove the stored consignment for the multi-item consignment
                            if (multiConsignment.id) {
                                removeStoredConsignment(multiConsignment.id);
                            }
                        }


                        // OPTIMIZATION: Create all consignments in parallel
                        const consignmentCreationPromises = itemsToRestore.map(async ({ lineItemId, storedConsignment }) => {
                            try {
                                // Create a new consignment for this item
                                const createResult = await createConsignment(
                                    storedConsignment.shippingAddress,
                                    lineItemId,
                                    storedConsignment.quantity
                                );

                                // Find the newly created consignment
                                const newConsignments = createResult.consignments || [];
                                const newConsignment = newConsignments.find((c: any) =>
                                    c.lineItemIds.includes(lineItemId.toString())
                                );

                                return { lineItemId, storedConsignment, newConsignment };
                            } catch (error) {
                                console.error(`Error creating consignment for item ${lineItemId}:`, error);
                                return null;
                            }
                        });

                        const createdConsignments = await Promise.all(consignmentCreationPromises);

                        // OPTIMIZATION: Update shipping options in parallel
                        const shippingUpdatePromises = createdConsignments
                            .filter(result => result && result.newConsignment && result.storedConsignment.selectedShippingOptionId)
                            .map(async (result) => {
                                try {
                                    await updateConsignmentShippingOption(
                                        result!.newConsignment.id,
                                        result!.storedConsignment.selectedShippingOptionId
                                    );

                                    // Update the stored consignment with new ID
                                    updateStoredConsignment(
                                        result!.newConsignment.id,
                                        result!.lineItemId,
                                        result!.storedConsignment.quantity,
                                        result!.storedConsignment.shippingAddress,
                                        result!.storedConsignment.selectedShippingOptionId
                                    );
                                } catch (error) {
                                    console.error(`Error updating shipping option for item ${result!.lineItemId}:`, error);
                                }
                            });

                        await Promise.all(shippingUpdatePromises);

                        // Get updated consignments
                        const updatedCheckoutResponse = await fetch(
                            `/api/storefront/checkouts/${checkout.id}?include=consignments.availableShippingOptions,cart.lineItems.physicalItems.options`,
                            {
                                method: 'GET',
                                headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
                            }
                        );

                        if (updatedCheckoutResponse.ok) {
                            const updatedCheckoutData = await updatedCheckoutResponse.json();
                            currentConsignments = updatedCheckoutData.consignments || [];
                        }
                    }

                    // OPTIMIZATION: Process single-item consignments in parallel
                    const singleItemRestorationPromises = physicalItems.map(async (item) => {
                        const physicalItem = physicalItems.find(
                            physItem => physItem.id.toString() === item.id.toString()
                        );

                        const itemQuantity = physicalItem ? physicalItem.quantity : 1;
                        const existingConsignment = currentConsignments.find((c: { lineItemIds: string | any[]; }) =>
                            c.lineItemIds.length === 1 &&
                            c.lineItemIds[0] === item.id.toString()
                        );

                        if (existingConsignment && !existingConsignment.selectedShippingOption) {
                            const storedConsignment = findStoredConsignmentByLineItemId(
                                item.id,
                                itemQuantity
                            );

                            if (storedConsignment?.selectedShippingOptionId) {
                                try {
                                    await restoreConsignment(storedConsignment);
                                } catch (restoreError) {
                                    console.error(`Error restoring consignment for item ${item.id}:`, restoreError);
                                }
                            }
                        }
                    });

                    await Promise.all(singleItemRestorationPromises);

                    // Validate and remove invalid consignments
                    const consignmentsToRemove = currentConsignments.filter((consignment: any) => {
                        return !isConsignmentValidForDelivery(consignment);
                    });

                    if (consignmentsToRemove.length > 0) {
                        // OPTIMIZATION: Clear delivery dates in parallel
                        const clearDeliveryPromises = [];
                        for (const consignment of consignmentsToRemove) {
                            const lineItemIds = Array.isArray(consignment.lineItemIds)
                                ? consignment.lineItemIds
                                : [consignment.lineItemIds];

                            for (const lineItemId of lineItemIds) {
                                clearDeliveryPromises.push(clearDeliveryDateForItem(checkout.id, lineItemId));
                            }
                        }

                        await Promise.all(clearDeliveryPromises);

                        // OPTIMIZATION: Delete consignments in parallel
                        const deletePromises = consignmentsToRemove.map(async (consignment: any) => {
                            const options = {
                                method: 'DELETE',
                                headers: {
                                    'Accept': 'application/json'
                                }
                            };

                            await fetch(`/api/storefront/checkouts/${checkout.id}/consignments/${consignment.id}`, options);

                            if (consignment.id) {
                                removeStoredConsignment(consignment.id);
                            }
                        });

                        await Promise.all(deletePromises);
                    }

                    // Get final consignments state
                    const finalCheckoutResponse = await fetch(
                        `/api/storefront/checkouts/${checkout.id}?include=consignments.availableShippingOptions,cart.lineItems.physicalItems.options`,
                        {
                            method: 'GET',
                            headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
                        }
                    );

                    let finalConsignments = [];
                    if (finalCheckoutResponse.ok) {
                        const finalCheckoutData = await finalCheckoutResponse.json();
                        finalConsignments = finalCheckoutData.consignments || [];
                    }

                    // Initialize consignments for all items
                    const initialConsignments = physicalItems.map(item => {
                        const existingConsignment = finalConsignments.find(
                            (c: any) => c.lineItemIds.includes(item.id.toString())
                        );

                        if (existingConsignment && existingConsignment.selectedShippingOption) {
                            return {
                                id: existingConsignment.id,
                                lineItemId: item.id as string,
                                shippingAddress: existingConsignment.shippingAddress,
                                selectedShippingOption: existingConsignment.selectedShippingOption,
                                availableShippingOptions: existingConsignment.availableShippingOptions || [],
                            };
                        }

                        return {
                            lineItemId: item.id as string,
                            shippingAddress: null,
                            selectedShippingOption: null,
                            availableShippingOptions: [],
                        };
                    });

                    setItemConsignments(initialConsignments);

                    // // Set up configured items map
                    // const configuredItemsMap: { [key: string]: boolean } = {};

                    // // OPTIMIZATION: Check all configurations in parallel
                    // const configurationPromises = initialConsignments.map((consignment) => {
                    //     const hasAddressAndShipping = Boolean(
                    //         consignment.shippingAddress && consignment.selectedShippingOption
                    //     );

                    //     // Get delivery date directly from physicalItems options
                    //     const physicalItem = physicalItems.find(item => item.id.toString() === consignment.lineItemId.toString());
                    //     const hasValidDeliveryDateValue = physicalItem?.options?.some((option: any) =>
                    //         (option.name === "Delivery Date" || option.name.includes("Delivery Date")) &&
                    //         option.value && option.value.trim() !== ''
                    //     ) ?? true;

                    //     return {
                    //         lineItemId: consignment.lineItemId,
                    //         isConfigured: hasAddressAndShipping && hasValidDeliveryDateValue
                    //     };
                    // });

                    // const configurationResults = configurationPromises; // No need for Promise.all since it's synchronous now
                    // configurationResults.forEach(result => {
                    //     configuredItemsMap[result.lineItemId] = result.isConfigured;
                    // });

                    // setConfiguredItems(configuredItemsMap);

                    // Set up configured items map
                    const configuredItemsMap: { [key: string]: boolean } = {};

                    // Check all configurations properly
                    const configurationResults = await Promise.all(
                        initialConsignments.map(async (consignment) => {
                            const hasAddressAndShipping = Boolean(
                                consignment.shippingAddress && consignment.selectedShippingOption
                            );

                            // Check delivery date from localStorage instead of physicalItems options
                            const hasValidDeliveryDate = checkDeliveryDateFromLocalStorage(consignment.lineItemId);

                            return {
                                lineItemId: consignment.lineItemId,
                                isConfigured: hasAddressAndShipping && hasValidDeliveryDate
                            };
                        })
                    );

                    configurationResults.forEach(result => {
                        configuredItemsMap[result.lineItemId] = result.isConfigured;
                    });

                    setConfiguredItems(configuredItemsMap);

                    // Set current item index to the first unconfigured item
                    const firstUnconfiguredIndex = physicalItems.findIndex(
                        item => !configuredItemsMap[item.id]
                    );
                    setCurrentItemIndex(firstUnconfiguredIndex >= 0 ? firstUnconfiguredIndex : 0);

                    // If starting with an unconfigured item, clear selections
                    if (firstUnconfiguredIndex >= 0) {
                        setSelectedAddress(null);
                        setSelectedShippingOption(null);
                    }

                } catch (err) {
                    if (err instanceof Error) {
                        setError(`Error initializing: ${err.message}`);
                    }
                } finally {
                    setTimeout(() => {
                        setIsLoading(false);
                        setIsInitializing(false);
                    }, 100);
                }
            }
        };

        initConsignments();
    }, []);

    // Load shipping options for current item when item index changes
    useEffect(() => {
        const loadCurrentItemShippingOptions = async () => {
            // Start by clearing selections
            setSelectedAddress(null);
            setSelectedShippingOption(null);
            setSelectedDeliveryDate(null);
            setSelectedShippingDate(null); // Clear previous selected date
            //setAvailableShippingDates([]); // Clear available dates

            setIsLoading(true);
            try {
                const currentItem = getCurrentItem();
                if (!currentItem) return;

                // Get the updated consignment
                const updatedConsignments = getCheckout()?.consignments || [];
                const updatedConsignment = updatedConsignments.find(c =>
                    c.lineItemIds.includes(currentItem.id.toString())
                );

                if (updatedConsignment) {
                    // Only set selections if shipping options are available
                    const hasShippingOptions =
                        updatedConsignment.availableShippingOptions &&
                        updatedConsignment.availableShippingOptions.length > 0;

                    if (hasShippingOptions &&
                        updatedConsignment.shippingAddress &&
                        updatedConsignment.selectedShippingOption) {

                        setSelectedAddress(updatedConsignment.shippingAddress);
                        setSelectedShippingOption(updatedConsignment.selectedShippingOption);

                        // Get shipping date (the date selected from calendar)
                        const shipDate = await getItemShippingDate(currentItem.id);

                        if (shipDate) {
                            try {
                                const dateParts = shipDate.split('/');
                                if (dateParts.length === 3) {
                                    const month = parseInt(dateParts[0]) - 1; // JS months are 0-indexed
                                    const day = parseInt(dateParts[1]);
                                    const year = parseInt(dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2]);

                                    const deliveryDateObj = new Date(year, month, day);
                                    deliveryDateObj.setHours(0, 0, 0, 0);

                                    if (!isNaN(deliveryDateObj.getTime())) {
                                        setSelectedShippingDate(deliveryDateObj);
                                    }
                                }
                            } catch (error) {
                                console.error('Error parsing delivery date:', error);
                            }
                        }

                        // Get actual delivery date (MM/DD/YYYY format)
                        const deliveryDate = await getItemDeliveryDate(currentItem.id);

                        if (deliveryDate) {
                            try {
                                const dateParts = deliveryDate.split('/');
                                if (dateParts.length === 3) {
                                    const month = parseInt(dateParts[0]) - 1; // JS months are 0-indexed
                                    const day = parseInt(dateParts[1]);
                                    const year = parseInt(dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2]);

                                    const deliveryDateObj = new Date(year, month, day);
                                    deliveryDateObj.setHours(0, 0, 0, 0);

                                    if (!isNaN(deliveryDateObj.getTime())) {
                                        setSelectedDeliveryDate(deliveryDateObj);
                                    }
                                }
                            } catch (error) {
                                console.error('Error parsing delivery date:', error);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('Error loading current item shipping options:', err);
            } finally {
                setIsLoading(false);
            }
        };

        // Only run this if we're not in editing mode yet and moving to a new item
        if (!isEditing && !isInitializing) {
            loadCurrentItemShippingOptions();
        }
    }, [currentItemIndex, isInitializing]);

    useEffect(() => {
        // Check if multiple consignments use the same address
        const addressMap = new Map();
        let hasDuplicateAddresses = false;

        itemConsignments.forEach(consignment => {
            if (consignment.shippingAddress) {
                const addressKey = getAddressKey(consignment.shippingAddress);
                if (addressMap.has(addressKey)) {
                    hasDuplicateAddresses = true;
                } else {
                    addressMap.set(addressKey, true);
                }
            }
        });

        // If we have duplicate addresses and all items are configured,
        // force a refresh of checkout totals
        if (hasDuplicateAddresses && allItemsConfigured) {
            refreshCheckoutTotals();
        }
    }, [itemConsignments, allItemsConfigured]);

    // Helper function to generate a unique key for an address
    const getAddressKey = (address: any) => {
        return `${address.firstName}|${address.lastName}|${address.address1}|${address.city}|${address.stateOrProvinceCode}|${address.postalCode}|${address.countryCode}`;
    };

    // Call onReady to signal the component is ready
    useEffect(() => {
        onReady();
    }, [onReady]);

    // Check if all items are configured
    // Replace the existing useEffect with this updated version:

    useEffect(() => {
        const checkAllItemsConfigured = async () => {
            if (physicalItems.length === 0) {
                setAllItemsConfigured(false);
                return;
            }

            // Use Promise.all to properly handle async operations
            const configurationChecks = await Promise.all(
                physicalItems.map(async (item) => {
                    // Check if the item has a shipping address and shipping option
                    const isBasicConfigured = Boolean(configuredItems[item.id]);

                    // Check if the item has a valid delivery date using localStorage
                    const hasDeliveryDate = checkDeliveryDateFromLocalStorage(item.id);

                    // Item is fully configured only if both conditions are met
                    return isBasicConfigured && hasDeliveryDate;
                })
            );

            // Check if all items are configured
            const allConfigured = configurationChecks.every(isConfigured => isConfigured);
            setAllItemsConfigured(allConfigured);
        };

        checkAllItemsConfigured();
    }, [physicalItems, configuredItems]);

    // Add this helper function to check delivery date from localStorage:
    const checkDeliveryDateFromLocalStorage = (itemId: string | number): boolean => {
        try {
            const itemDataString = localStorage.getItem(itemId.toString());

            if (!itemDataString) {
                return false; // No data in localStorage
            }

            const itemData = JSON.parse(itemDataString);

            // Check if deliveryDate exists and is not empty
            if (!itemData.deliveryDate || itemData.deliveryDate.trim() === '') {
                return false;
            }

            // Optional: Also check if the delivery date is in the future
            const deliveryDate = new Date(itemData.deliveryDate);
            const currentDate = new Date();

            // Return true if delivery date is valid and in the future
            return !isNaN(deliveryDate.getTime()) && deliveryDate > currentDate;

        } catch (error) {
            console.error('Error parsing localStorage data for item:', itemId, error);
            return false;
        }
    };

    const getCurrentItem = () => {
        return physicalItems[currentItemIndex];
    };

    const getCurrentConsignment = () => {
        const currentItem = getCurrentItem();
        return currentItem ? itemConsignments.find(c => c.lineItemId === currentItem.id) : undefined;
    };

    // Create or update a consignment for a line item
    const createConsignment = async (address: Address, lineItemId: string | number, quantity: number) => {
        const checkout = getCheckout();
        //   console.log('checkout', checkout)
        if (!checkout) {
            throw new Error('Checkout not available');
        }
        // First fetch the latest checkout data to get current consignments
        const checkoutOptions = {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        };

        let currentConsignments = [];
        try {
            const checkoutResponse = await fetch(`/api/storefront/checkouts/${checkout.id}`, checkoutOptions);
            if (!checkoutResponse.ok) {
                throw new Error('Failed to fetch checkout data');
            }

            const checkoutData = await checkoutResponse.json();
            currentConsignments = checkoutData.consignments || [];
        } catch (error) {
            console.error('Error fetching latest checkout data:', error);
            // Fall back to state data if fetch fails
            currentConsignments = consignments || [];
        }
        // First check if this item already has a consignment
        const existingConsignment = currentConsignments.find((consignment: { lineItemIds: string | any[]; }) =>
            consignment.lineItemIds.length === 1 &&
            consignment.lineItemIds[0] === lineItemId.toString()
        );

        // If a consignment already exists for this item with only this item,
        // update it instead of creating a new one
        if (existingConsignment) {
            const options = {
                method: 'PUT',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    address: address,
                    lineItems: [{
                        itemId: lineItemId,
                        quantity: quantity
                    }]
                })
            };

            try {
                const response = await fetch(`/api/storefront/checkouts/${checkout.id}/consignments/${existingConsignment.id}?include=consignments.availableShippingOptions`, options);

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.title || 'Error updating consignment');
                }

                return await response.json();
            } catch (error) {
                if (error instanceof Error) {
                    throw error;
                }
                throw new Error('Unknown error updating consignment');
            }
        }
        // Otherwise create a new consignment
        else {
            const options = {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify([{
                    address: address,
                    lineItems: [{
                        itemId: lineItemId,
                        quantity: quantity
                    }]
                }])
            };

            try {
                const response = await fetch(`/api/storefront/checkouts/${checkout.id}/consignments?include=consignments.availableShippingOptions`, options);

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.title || 'Error creating consignment');
                }

                return await response.json();
            } catch (error) {
                if (error instanceof Error) {
                    throw error;
                }
                throw new Error('Unknown error creating consignment');
            }
        }
    };

    // Update a consignment's shipping option using the Storefront API
    const updateConsignmentShippingOption = async (consignmentId: string, shippingOptionId: string) => {
        const checkout = getCheckout();

        if (!checkout) {
            throw new Error('Checkout not available');
        }

        const options = {
            method: 'PUT',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                shippingOptionId: shippingOptionId
            })
        };

        try {
            const response = await fetch(`/api/storefront/checkouts/${checkout.id}/consignments/${consignmentId}`, options);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.title || 'Error updating shipping option');
            }

            return await response.json();
        } catch (error) {
            if (error instanceof Error) {
                throw error;
            }
            throw new Error('Unknown error updating shipping option');
        }
    };



    // Handle shipping address selection
    const handleAddressSelect = async (address: Address) => {
        // Validate address before proceeding
        if (getFields && !isValidAddress(address, getFields(address.countryCode))) {
            setError('Please provide a valid address with all required fields');
            setIsEditing(false);
            onUnhandledError(new InvalidAddressError());
            return;
        }

        // Reset shipping option and delivery date when address changes
        setSelectedShippingOption(null);
        setSelectedShippingDate(null);
        setSelectedDeliveryDate(null);
        // setAvailableShippingDates([]);

        console.log('address', address);
        setSelectedAddress(address);
        setIsLoading(true);
        try {
            // Create consignment to get shipping options
            const currentItem = getCurrentItem();

            if (currentItem) {
                // Create a single consignment for this item via direct API call
                const result = await createConsignment(address, currentItem.id, currentItem.quantity);

                // Get updated consignments from response
                const updatedConsignments = result.consignments || [];

                // Find the consignment that contains our current item
                const newConsignment = updatedConsignments.find((c: any) =>
                    c.lineItemIds.some((lineItemId: string) =>
                        lineItemId === currentItem.id.toString() ||
                        lineItemId === String(currentItem.id)
                    )
                );
                //    console.log('newConsignment', newConsignment);

                // Update our item consignments list
                if (newConsignment) {
                    // Save consignment to session
                    saveConsignmentToSession(
                        newConsignment.id,
                        currentItem.id,
                        currentItem.quantity,
                        address,
                        '' // Clear shipping option ID when address changes
                    );

                    //       console.log('itemConsignments', itemConsignments);
                    const updatedItemConsignments = [...itemConsignments];
                    const currentIndex = updatedItemConsignments.findIndex(c => c.lineItemId === currentItem.id);

                    if (currentIndex >= 0) {
                        // Update existing consignment in the array
                        updatedItemConsignments[currentIndex] = {
                            ...updatedItemConsignments[currentIndex],
                            id: newConsignment.id,
                            shippingAddress: address,
                            selectedShippingOption: null, // Clear shipping option when address changes
                            availableShippingOptions: newConsignment.availableShippingOptions || [],
                        };
                    } else {
                        // Add new consignment to the array if not found
                        updatedItemConsignments.push({
                            id: newConsignment.id,
                            lineItemId: currentItem.id,
                            shippingAddress: address,
                            availableShippingOptions: newConsignment.availableShippingOptions || [],
                            selectedShippingOption: null // No shipping option selected initially
                        });
                    }

                    // Update the state with either updated or newly added consignment
                    setItemConsignments(updatedItemConsignments);
                } else {
                    // Handle case where no consignment was found for the current item
                    console.error('No consignment found for item', currentItem.id);
                    setError('Failed to create shipping option. Please try again.');
                }
            }
        } catch (err) {
            if (err instanceof Error) {
                setError(err.message);
                setIsEditing(false);
                onUnhandledError(err);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const refreshCheckoutTotals = async () => {
        setIsLoading(true);
        try {
            const checkout = getCheckout();
            if (!checkout) {
                return;
            }

            // Force a complete refresh of checkout data to update shipping totals
            // const options = {
            //     method: 'GET',
            //     headers: {
            //         'Accept': 'application/json',
            //         'Cache-Control': 'no-cache, no-store'
            //     }
            // };

            // This direct API call forces BigCommerce to recalculate all shipping totals
            // but does NOT auto-select shipping options
            // await fetch(`/api/storefront/checkouts/${checkout.id}?include=cart.lineItems.physicalItems.options,consignments.availableShippingOptions`, options);

            // Reload checkout to sync UI with the latest state
            await loadCheckout();
        } catch (err) {
            console.error('Error refreshing checkout totals:', err);
        } finally {
            setIsLoading(false);
        }
    };
    const setItemOptions = async (storageKey: string) => {
        var lineId = storageKey;

        try {
            // 1. Get local storage data using line id
            const localStorageData = localStorage.getItem(lineId);
            if (!localStorageData) {
                throw new Error('No local storage data found for this item');
            }

            const parsedLocalData = JSON.parse(localStorageData);

            // 2. Fetch cart to get item and product id
            const cartResponse = await fetch('/api/storefront/carts?include=lineItems.physicalItems.options', {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                }
            });

            if (!cartResponse.ok) {
                throw new Error('Failed to fetch cart data');
            }

            const cartData = await cartResponse.json();
            const cartItem = cartData[0]?.lineItems.physicalItems.find(
                (item: { id: any; }) => item.id.toString() === lineId
            );

            if (!cartItem) {
                throw new Error('Cart item not found');
            }

            const productId = cartItem.productId;

            // 3. Get session storage data or fetch from API
            const sessionStorageKey = productId;
            let sessionData = sessionStorage.getItem(sessionStorageKey);
            let optionsData;

            if (!sessionData) {
                // Fetch options from API
                const optionsResponse = await fetch('https://bc-middleware-mm.onrender.com/cart/get-options', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        itemId: [productId.toString()]
                    })
                });

                if (!optionsResponse.ok) {
                    throw new Error('Failed to fetch product options');
                }

                optionsData = await optionsResponse.json();

                // Store in session storage
                sessionStorage.setItem(sessionStorageKey, JSON.stringify(optionsData[productId]));
            } else {
                optionsData = JSON.parse(sessionData);
            }

            // Get options for current product
            const productOptions = optionsData;
            if (!productOptions) {
                throw new Error('Product options not found');
            }

            // 4. Build current option selections map for easy comparison
            const currentOptions = cartItem.options || [];
            const currentOptionsMap = new Map();
            currentOptions.forEach((option: { nameId: any; value: any; valueId: any; }) => {
                currentOptionsMap.set(option.nameId, option.valueId || option.value);
            });

            // 5. Build new option selections preserving existing options
            const optionSelections = currentOptions.map((option: { nameId: any; value: any; valueId: any; }) => ({
                optionId: option.nameId,
                optionValue: option.valueId || option.value
            }));

            let hasChanges = false;

            // 6. Check/update delivery date option
            if (productOptions.deliveryDate && parsedLocalData.deliveryDate) {
                // Format delivery date as mm/dd/yyyy
                const deliveryDate = new Date(parsedLocalData.deliveryDate);
                const formattedDeliveryDate = deliveryDate.toLocaleDateString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    year: 'numeric'
                });

                const currentDeliveryDate = currentOptionsMap.get(productOptions.deliveryDate);

                if (currentDeliveryDate !== formattedDeliveryDate) {
                    hasChanges = true;
                    const deliveryDateIndex = optionSelections.findIndex(
                        (option: { optionId: any; }) => option.optionId === productOptions.deliveryDate
                    );

                    if (deliveryDateIndex >= 0) {
                        optionSelections[deliveryDateIndex].optionValue = formattedDeliveryDate;
                    } else {
                        optionSelections.push({
                            optionId: productOptions.deliveryDate,
                            optionValue: formattedDeliveryDate
                        });
                    }
                }
            }

            // 7. Check/update ship date option
            if (productOptions.shipDate && parsedLocalData.dispatchDate) {
                // Format dispatch date as mm/dd/yyyy
                const dispatchDate = new Date(parsedLocalData.dispatchDate);
                const formattedDispatchDate = dispatchDate.toLocaleDateString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    year: 'numeric'
                });

                const currentShipDate = currentOptionsMap.get(productOptions.shipDate);

                if (currentShipDate !== formattedDispatchDate) {
                    hasChanges = true;
                    const shipDateIndex = optionSelections.findIndex(
                        (option: { optionId: any; }) => option.optionId === productOptions.shipDate
                    );

                    if (shipDateIndex >= 0) {
                        optionSelections[shipDateIndex].optionValue = formattedDispatchDate;
                    } else {
                        optionSelections.push({
                            optionId: productOptions.shipDate,
                            optionValue: formattedDispatchDate
                        });
                    }
                }
            }

            // 8. Check/update gift message option
            if (productOptions.giftMessage && parsedLocalData.giftMessage !== undefined) {
                const currentGiftMessage = currentOptionsMap.get(productOptions.giftMessage);

                if (currentGiftMessage !== parsedLocalData.giftMessage) {
                    hasChanges = true;
                    const giftMessageIndex = optionSelections.findIndex(
                        (option: { optionId: any; }) => option.optionId === productOptions.giftMessage
                    );

                    if (giftMessageIndex >= 0) {
                        optionSelections[giftMessageIndex].optionValue = parsedLocalData.giftMessage;
                    } else {
                        optionSelections.push({
                            optionId: productOptions.giftMessage,
                            optionValue: parsedLocalData.giftMessage
                        });
                    }
                }
            }

            // 9. Only update if there are changes
            if (!hasChanges) {
                console.log('No changes detected in item options, skipping update');
                return;
            }

            // 10. Get checkout for cart update
            const checkout = getCheckout();
            if (!checkout) {
                throw new Error('Checkout not available');
            }

            // 11. Update the cart item with new options
            const updateResponse = await fetch(`/api/storefront/carts/${checkout.id}/items/${lineId}`, {
                method: 'PUT',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    lineItem: {
                        productId: cartItem.productId,
                        variantId: cartItem.variantId,
                        quantity: cartItem.quantity,
                        optionSelections: optionSelections
                    }
                })
            });

            if (!updateResponse.ok) {
                throw new Error('Failed to update cart item options');
            }

            console.log('Item options updated successfully');

        } catch (error) {
            console.error('Error updating item options:', error);
            throw error;
        }
    };

    const handleContinue = async () => {
        if (!selectedAddress) {
            setError('Please select a shipping address');
            return;
        }
        const currentItem = getCurrentItem();

        if (!selectedShippingOption) {
            setError('Please select a shipping method');
            return;
        }
        const storageKey = `${currentItem.id}`;
        const existingData = localStorage.getItem(storageKey);
        if (!existingData) {
            setError('Please fill all mandatory field');
            return;
        }
        else {
            const parsedData = JSON.parse(existingData);

            if (!parsedData.deliveryDate) {
                setError('Please select a delivery date');
                return;
            }

            if (!parsedData.giftMessage) {
                setError('Please add/skip the gift message by clicking the "Add Gift Message" button');
                return;
            }
        }

        // Set loading to true at the start
        setIsLoading(true);

        try {
            // Update item options
            await setItemOptions(storageKey);

            // Update local state after setting options
            const updatedItemConsignments = [...itemConsignments];
            const currentIndex = updatedItemConsignments.findIndex(c => c.lineItemId === currentItem.id);

            if (currentIndex >= 0) {
                updatedItemConsignments[currentIndex] = {
                    ...updatedItemConsignments[currentIndex],
                    selectedShippingOption: selectedShippingOption,
                };
                setItemConsignments(updatedItemConsignments);
            }

            // Make sure changes are synchronized with checkout state
            // await loadCheckout();
            // await updateOrderSummaryDisplay();

            // Mark this item as configured
            if (currentItem) {
                // Create a fresh copy of the configured items state
                const updatedConfiguredItems = { ...configuredItems };

                // Mark the current item as configured
                updatedConfiguredItems[currentItem.id] = true;

                // Create an array to store all the async checks
                const configurationChecks = await Promise.all(
                    physicalItems.map(async (item) => {
                        if (item.id !== currentItem.id) {
                            // For other items, verify that they're actually configured
                            const consignment = itemConsignments.find(c => c.lineItemId === item.id);
                            const isFullyConfigured = Boolean(
                                consignment &&
                                consignment.shippingAddress &&
                                consignment.selectedShippingOption
                            );
                            const hasDeliveryDate = await hasValidOptionValue(item.id, "Delivery Date");

                            // Only mark as configured if both conditions are met
                            return { itemId: item.id, isConfigured: isFullyConfigured && hasDeliveryDate };
                        }
                        return { itemId: item.id, isConfigured: updatedConfiguredItems[item.id] };
                    })
                );

                // Apply all configuration results
                configurationChecks.forEach(({ itemId, isConfigured }) => {
                    updatedConfiguredItems[itemId] = isConfigured;
                });

                // Update the state with the new accurate configuration
                setConfiguredItems(updatedConfiguredItems);
                setIsEditing(false);

                // If there are more items, go to the next one
                if (currentItemIndex < physicalItems.length - 1) {
                    // Find the next unconfigured item using our updated state
                    let nextItemIndex = currentItemIndex + 1;

                    // Skip already configured items
                    while (
                        nextItemIndex < physicalItems.length &&
                        updatedConfiguredItems[physicalItems[nextItemIndex].id]
                    ) {
                        nextItemIndex++;
                    }

                    if (nextItemIndex < physicalItems.length) {
                        setCurrentItemIndex(nextItemIndex);

                        // Clear selections before checking next item
                        setSelectedAddress(null);
                        setSelectedShippingOption(null);

                        // Get the next item's consignment
                        const nextItem = physicalItems[nextItemIndex];
                        const nextConsignment = itemConsignments.find(c => c.lineItemId === nextItem.id);

                        // Only set selections if the consignment has valid shipping options
                        if (nextConsignment &&
                            nextConsignment.shippingAddress &&
                            nextConsignment.selectedShippingOption &&
                            nextConsignment.availableShippingOptions &&
                            nextConsignment.availableShippingOptions.length > 0) {

                            setSelectedAddress(nextConsignment.shippingAddress);
                            setSelectedShippingOption(nextConsignment.selectedShippingOption);
                        }
                    }
                }

                await refreshCheckoutTotals();

                // Add a small delay to ensure UI updates are complete
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } catch (error) {
            console.error('Error in handleContinue:', error);
            setError(error instanceof Error ? error.message : 'An unexpected error occurred');
        } finally {
            // Only set loading to false after all operations are complete
            setIsLoading(false);
        }
    };

    const handleUseNewAddress = () => {
        setIsAddAddressModalOpen(true);
    };

    const handleCloseAddAddressForm = () => {
        setIsAddAddressModalOpen(false);
    };

    const handleEditGuestAddress = () => {
        setIsEditingGuestAddress(true);
        setIsAddAddressModalOpen(true);
    };

    const handleSaveAddress = async (addressFormValues: AddressFormValues) => {
        try {
            // First convert form values to an address object
            const address = mapAddressFromFormValues(addressFormValues);

            // Make sure the address is valid before proceeding
            if (getFields && !isValidAddress(address, getFields(address.countryCode))) {
                setError('Please provide a valid address with all required fields');
                onUnhandledError(new InvalidAddressError());
                return;
            }

            // Check if customer is logged in (not a guest) before setting shouldSaveAddress
            const checkout = getCheckout();
            if (checkout && checkout.customer && checkout.customer.id !== 0) {
                // Only set shouldSaveAddress to true for logged-in customers
                address.shouldSaveAddress = true;
                if (createCustomerAddress) {
                    try {
                        await createCustomerAddress(address);
                    } catch (error) {
                        if (error instanceof Error) {
                            setCreateCustomerAddressError(error);
                        }
                    }
                }
            } else {
                address.shouldSaveAddress = false;
                const currentItem = getCurrentItem();

                if (currentItem) {
                    const storageKey = `guestAddress_${currentItem.id}`;
                    localStorage.setItem(storageKey, JSON.stringify(address));

                    // Update item-specific guest addresses state
                    setItemGuestAddresses(prev => ({
                        ...prev,
                        [currentItem.id.toString()]: address
                    }));
                }

                setIsEditingGuestAddress(false);
            }



            // Select the address for shipping after creating it
            await handleAddressSelect(address);
            setIsAddAddressModalOpen(false);
        } catch (err) {
            if (err instanceof Error) {
                setError(err.message);
                onUnhandledError(err);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleCloseErrorModal = () => {
        setCreateCustomerAddressError(undefined);
    };

    const updateOrderSummaryDisplay = async () => {
        const checkout = getCheckout();

        if (!checkout) {
            return;
        }

        // // Create a specific update to force recalculation of shipping totals in UI
        // const options = {
        //     method: 'PUT',
        //     headers: {
        //         'Accept': 'application/json',
        //         'Content-Type': 'application/json'
        //     },
        //     // We're not actually changing anything, just forcing a UI refresh
        //     body: JSON.stringify({
        //         // Include customerMessage to avoid mutations being ignored
        //         customerMessage: checkout.customerMessage || ''
        //     })
        // };

        try {
            // await fetch(`/api/storefront/checkouts/${checkout.id}`, options);

            // Reload checkout to ensure UI gets updated
            await loadCheckout();
        } catch (err) {
            console.error('Error updating order summary display:', err);
        }
    };


    const handleSplitLineItem = async (lineItemId: string | number, quantity: number) => {
        if (quantity <= 1) return;

        setIsLoading(true);
        try {
            const checkout = getCheckout();
            if (!checkout) {
                throw new Error('Checkout not available');
            }

            const currentItem = physicalItems.find(item => item.id === lineItemId);
            if (!currentItem) {
                throw new Error('Item not found');
            }

            // Prepare base address for split items
            const baseAddress = {
                firstName: '',
                lastName: '',
                address1: '',
                address2: '',
                city: 'Los Angeles',
                stateOrProvince: 'California',
                stateOrProvinceCode: 'CA',
                countryCode: 'US',
                postalCode: '90017',
                phone: ''
            };

            // Create consignments for each split item
            const splitConsignments = Array.from({ length: quantity }, () => ({
                address: { ...baseAddress },
                lineItems: [{
                    itemId: lineItemId.toString(),
                    quantity: 1
                }]
            }));

            // Make API call to create split consignments
            const options = {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(splitConsignments)
            };

            const response = await fetch(
                `/api/storefront/checkouts/${checkout.id}/consignments?include=consignments.availableShippingOptions`,
                options
            );

            if (!response.ok) {
                throw new Error('Failed to split line item');
            }

            const result = await response.json();
            const updatedConsignments = result.consignments || [];

            const currentConsignments = updatedConsignments || [];
            // Update local state to reflect split items
            const newItemConsignments = updatedConsignments.map((consignment: any) => ({
                id: consignment.id,
                lineItemId: consignment.lineItemIds[0],
                shippingAddress: null,
                selectedShippingOption: null,
                availableShippingOptions: consignment.availableShippingOptions || [],
            }));



            for (const item of newItemConsignments) {
                const physicalItem = physicalItems.find(
                    physItem => physItem.id.toString() === item.lineItemId.toString()
                );

                // Get the quantity dynamically
                const itemQuantity = physicalItem ? physicalItem.quantity : 1;
                // Check if this item already has a consignment
                const existingConsignment = currentConsignments.find((c: { lineItemIds: string | any[]; }) =>
                    c.lineItemIds.length === 1 &&
                    c.lineItemIds[0] === item.lineItemId.toString() &&
                    c.lineItemIds.length === 1
                );

                // 1. Consignment exists but has no shipping option or address
                if (
                    (existingConsignment &&
                        (!existingConsignment.selectedShippingOption ||
                            !existingConsignment.shippingAddress ||
                            Object.keys(existingConsignment.shippingAddress).length === 0)
                    )
                ) {
                    const storedConsignment = findStoredConsignmentByLineItemId(
                        item.lineItemId,
                        itemQuantity
                    );

                    // If stored consignment exists, restore it
                    if (storedConsignment?.selectedShippingOptionId) {
                        try {
                            await restoreConsignment(storedConsignment);
                        } catch (restoreError) {
                            console.error(`Error restoring consignment for item ${item.lineItemId}:`, restoreError);
                        }
                    }
                }
            }


            const checkoutOptions = {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache, no-store'
                }
            };


            const checkoutResponse = await fetch(`/api/storefront/checkouts/${checkout.id}?include=cart.lineItems.physicalItems.options,consignments.availableShippingOptions`, checkoutOptions);

            const checkoutResult = await checkoutResponse.json();
            const newConsignments = checkoutResult.consignments || [];

            // Reload checkout to sync state and update UI
            //await loadCheckout();


            // Update or create stored consignments for each new consignment
            newConsignments.forEach((consignment: any) => {

                const physicalItem = physicalItems.find(
                    physItem => physItem.id.toString() === consignment.lineItemIds[0].toString()
                );

                // Get the quantity dynamically
                const itemQuantity = physicalItem ? physicalItem.quantity : 1;
                // Save or update consignment in session storage
                saveConsignmentToSession(
                    consignment.id,
                    consignment.lineItemIds[0],
                    itemQuantity,
                    consignment.shippingAddress || baseAddress,
                    consignment.selectedShippingOption?.id || ''
                );
            });


            const mergeConsignments = (existingConsignments: ConsignmentWithItem[], newConsignments: any[]) => {
                // Create a map to help with deduplication and prioritization
                const consignmentMap = new Map<string | number, ConsignmentWithItem>();

                // First, add existing consignments
                existingConsignments.forEach(consignment => {
                    if (!consignmentMap.has(consignment.lineItemId)) {
                        consignmentMap.set(consignment.lineItemId, consignment);
                    }
                });

                // Add or update with new consignments
                newConsignments.forEach(newConsignment => {
                    const lineItemId = newConsignment.lineItemIds[0];
                    const existingConsignment = consignmentMap.get(lineItemId);

                    const newConsignmentObj = {
                        id: newConsignment.id,
                        lineItemId,
                        shippingAddress: newConsignment.shippingAddress,
                        selectedShippingOption: newConsignment.selectedShippingOption,
                        availableShippingOptions: newConsignment.availableShippingOptions || [],
                    };

                    // Prioritize consignments with complete shipping info
                    if (!existingConsignment ||
                        (newConsignmentObj.shippingAddress && newConsignmentObj.selectedShippingOption)) {
                        consignmentMap.set(lineItemId, newConsignmentObj);
                    }
                });

                return Array.from(consignmentMap.values());
            };

            // Replace all setItemConsignments calls with this merged version
            setItemConsignments(prevConsignments =>
                mergeConsignments(prevConsignments, newConsignments)
            );

            // Update configured items state
            // const newConfiguredItems = { ...configuredItems };
            // newItemConsignments.forEach((consignment: { lineItemId: string | number; }) => {
            //     newConfiguredItems[consignment.lineItemId] = false;
            // });
            const newConfiguredItems = { ...configuredItems };

            itemConsignments.forEach((consignment: {
                lineItemId: string | number;
                shippingAddress?: any;
                selectedShippingOption?: any;
            }) => {
                // Only mark as false if it's not fully configured
                // If it has both shipping address and shipping option, keep it as true if it was already true

                const isFullyConfigured =
                    consignment.shippingAddress &&
                    Object.keys(consignment.shippingAddress).length > 0 &&
                    consignment.selectedShippingOption;


                // Only update if not fully configured or if it wasn't previously configured
                if (!isFullyConfigured || !newConfiguredItems[consignment.lineItemId]) {
                    newConfiguredItems[consignment.lineItemId] = false;
                }
            });


            setConfiguredItems(newConfiguredItems);

            // Maintain editing context
            const currentIndex = physicalItems.findIndex(item => item.id === lineItemId);
            setCurrentItemIndex(currentIndex);
            setIsEditing(true);

            // Reset selections
            setSelectedAddress(null);
            setSelectedShippingOption(null);

            // Refresh checkout totals
            await refreshCheckoutTotals();
        } catch (err) {
            if (err instanceof Error) {
                setError(`Error splitting line item: ${err.message}`);
                onUnhandledError(err);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const restoreConsignment = async (storedConsignment: any) => {
        const checkout = getCheckout();
        if (!checkout) {
            throw new Error('Checkout not available');
        }

        try {
            // Check if a consignment already exists for this line item
            const existingConsignments = checkout.consignments || [];
            const existingConsignment = existingConsignments.find(c =>
                c.lineItemIds.includes(storedConsignment.lineItemId.toString())
            );

            let response;
            if (existingConsignment) {
                const consignmentPayload = {
                    shippingOptionId: storedConsignment.selectedShippingOptionId
                };
                // Update existing consignment
                const options = {
                    method: 'PUT',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(consignmentPayload)
                };

                response = await fetch(
                    `/api/storefront/checkouts/${checkout.id}/consignments/${existingConsignment.id}?include=consignments.availableShippingOptions`,
                    options
                );

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.title || 'Failed to restore consignment');
                }

                // Reload checkout to sync state
                //await loadCheckout();

                return await response.json();
            }
        } catch (error) {
            console.error('Error restoring consignment:', error);
            throw error;
        }
    };

    const handleAddGiftMessage = async (lineItemId: string | number) => {
        setCurrentGiftMessageItemId(lineItemId);
        setEditedGiftMessage('');
        setIsEditGiftMessageModalOpen(true);
    }

    const handleEditGiftMessage = async (lineItemId: string | number, message: string | undefined) => {
        const safeMessage = message ?? '';

        setCurrentGiftMessageItemId(lineItemId);
        setEditedGiftMessage(safeMessage);
        setIsEditGiftMessageModalOpen(true);
    };


    const getItemOptions = (itemId: string | Number, optionName: string) => {
        let optionValue = ""
        const itemDetailsString = localStorage.getItem(itemId.toString());
        if (itemDetailsString) {
            try {
                const itemDetails: any = JSON.parse(itemDetailsString);
                let optionId = ''
                if (optionName == "Delivery Date") {
                    optionId = "deliveryDate"
                }
                else if (optionName == "Ship Date") {
                    optionId = "dispatchDate"
                }
                else {
                    optionId = "giftMessage"
                }


                optionValue = itemDetails[optionId];
            } catch (error) {
                console.error('Error parsing localStorage data:', error);
                return null;
            }
        }
        return optionValue;
    };

    const handleSubmitGiftMessage = async (message: string) => {
        if (!currentGiftMessageItemId) return;

        try {
            setIsLoading(true);

            const storageKey = `${currentItem.id}`;
            const existingData = localStorage.getItem(storageKey);

            const giftMessage = {
                giftMessage: message,
                updatedAt: new Date().toISOString()
            };

            if (!existingData) {
                // Create new entry
                localStorage.setItem(storageKey, JSON.stringify(giftMessage));
            } else {
                // Update existing entry
                const parsedData = JSON.parse(existingData);
                const updatedData = {
                    ...parsedData,
                    ...giftMessage
                };
                localStorage.setItem(storageKey, JSON.stringify(updatedData));
            }

            setIsEditGiftMessageModalOpen(false);
            setCurrentGiftMessageItemId(null);
        } catch (error) {
            console.error('Error updating gift message:', error);
            setError(error instanceof Error ? error.message : 'An unexpected error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    const handleEditConsignment = async (index: number) => {
        // Check if any item is currently being edited
        const isAnyItemEditing = Object.values(configuredItems).some(
            (isConfigured) => isConfigured === false
        );

        // If another item is already being edited, prevent editing
        if (isAnyItemEditing) {
            setError('Please complete editing the current item first');
            return;
        }
        try {
            setIsLoading(true);
            setIsEditing(true);
            setCurrentItemIndex(index);
            // Get the current item ID
            const itemId = physicalItems[index]?.id;
            const checkout = getCheckout();

            if (!checkout) {
                throw new Error('Checkout not available');
            }

            // Fetch detailed checkout data
            const options = {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            };

            const response = await fetch(
                `/api/storefront/checkouts/${checkout.id}?include=cart.lineItems.physicalItems.options,consignments.availableShippingOptions`,
                options
            );

            if (!response.ok) {
                throw new Error('Failed to fetch checkout details');
            }

            const checkoutData = await response.json();

            // Find the specific consignment for this item
            const relevantConsignment = checkoutData.consignments?.find((c: any) =>
                c.lineItemIds.includes(itemId.toString())
            );

            // Prepare a fresh configuration state
            const updatedConfiguredItems = { ...configuredItems };
            Object.keys(updatedConfiguredItems).forEach(key => {
                // Mark all other items as configured
                if (key !== itemId.toString()) {
                    updatedConfiguredItems[key] = true;
                } else {
                    // Mark the current item as not configured
                    updatedConfiguredItems[key] = false;
                }
            });

            // Explicitly reset selections
            setSelectedAddress(null);
            setSelectedShippingOption(null);
            setSelectedShippingDate(null);
            setSelectedDeliveryDate(null);
            // setAvailableShippingDates([]);

            if (relevantConsignment) {
                // Update stored consignment
                updateStoredConsignment(
                    relevantConsignment.id,
                    itemId,
                    physicalItems[index].quantity,
                    relevantConsignment.shippingAddress,
                    relevantConsignment.selectedShippingOption?.id || ''
                );

                // Update local item consignments
                const updatedItemConsignments = [...itemConsignments];
                const consignmentIndex = updatedItemConsignments.findIndex(c => c.lineItemId === itemId);

                if (consignmentIndex >= 0) {
                    updatedItemConsignments[consignmentIndex] = {
                        ...updatedItemConsignments[consignmentIndex],
                        id: relevantConsignment.id,
                        availableShippingOptions: relevantConsignment.availableShippingOptions || [],
                        selectedShippingOption: relevantConsignment.selectedShippingOption,
                        shippingAddress: relevantConsignment.shippingAddress
                    };

                    setItemConsignments(updatedItemConsignments);

                    // Check if the consignment has both shipping address and shipping option
                    const hasValidConsignment =
                        relevantConsignment.shippingAddress &&
                        relevantConsignment.selectedShippingOption;

                    if (hasValidConsignment) {
                        // Directly set the existing address and shipping option
                        setSelectedAddress(relevantConsignment.shippingAddress);
                        setSelectedShippingOption(relevantConsignment.selectedShippingOption);

                        // Try to fetch shipping dates if applicable
                        if (relevantConsignment.availableShippingOptions &&
                            relevantConsignment.availableShippingOptions.length > 0) {

                            //calendar edits 
                            try {
                                const deliveryDate = await getItemDeliveryDate(itemId);
                                const shipDate = await getItemShippingDate(itemId);

                                if (shipDate) {
                                    try {
                                        const dateParts = shipDate.split('/');
                                        if (dateParts.length === 3) {
                                            const month = parseInt(dateParts[0]) - 1; // JS months are 0-indexed
                                            const day = parseInt(dateParts[1]);
                                            const year = parseInt(dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2]);

                                            const dateObj = new Date(year, month, day);

                                            if (!isNaN(dateObj.getTime())) {
                                                // Set the selected shipping date directly
                                                setSelectedShippingDate(dateObj);
                                            }
                                        }
                                    } catch (error) {
                                        console.error('Error parsing delivery date:', error);
                                    }
                                }

                                if (deliveryDate) {
                                    try {
                                        const dateParts = deliveryDate.split('/');
                                        if (dateParts.length === 3) {
                                            const month = parseInt(dateParts[0]) - 1; // JS months are 0-indexed
                                            const day = parseInt(dateParts[1]);
                                            const year = parseInt(dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2]);

                                            const dateObj = new Date(year, month, day);

                                            if (!isNaN(dateObj.getTime())) {
                                                // Set the selected shipping date directly
                                                setSelectedDeliveryDate(dateObj);
                                            }
                                        }
                                    } catch (error) {
                                        console.error('Error parsing delivery date:', error);
                                    }
                                }

                            } catch (error) {
                                console.error('Error fetching shipping calendar data:', error);
                            }
                        }
                    }

                    // Update configured items - set to false for this item
                    setConfiguredItems(updatedConfiguredItems);
                }

                // Refresh checkout totals
                await refreshCheckoutTotals();
            }
        } catch (err) {
            if (err instanceof Error) {
                setError(`Error editing consignment: ${err.message}`);
                onUnhandledError(err);

                setIsEditing(false);
                setCurrentItemIndex(-1);
            }
        } finally {
            setIsLoading(false);
            setIsLoadingDates(false);
        }
    };


    const handleDeliveryDateSubmit = async (shippingOption: any, deliveryDate: Date) => {
        setIsDeliveryDateModalOpen(false);
        setIsLoading(true);
        console.log('shippingOption', shippingOption)
        try {
            // Set selections in state immediately
            setSelectedShippingOption(shippingOption);
            setSelectedShippingDate(deliveryDate);

            if (shippingOption.deliveryDate) {
                // Parse the deliveryDate from the option (MM/DD/YYYY format)
                const [month, day, year] = shippingOption.deliveryDate.split('/');
                const deliveryDateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                setSelectedDeliveryDate(deliveryDateObj);
            }

            const currentConsignment = getCurrentConsignment();
            const currentItem = getCurrentItem();

            if (!currentConsignment || !currentItem) {
                throw new Error('Current consignment or item not found');
            }

            const checkout = getCheckout();
            if (!checkout) {
                throw new Error('Checkout not available');
            }

            if (currentConsignment.id) {
                const result = await updateConsignmentShippingOption(currentConsignment.id, shippingOption.id);

                // Get updated consignments
                const updatedConsignments = result.consignments || [];

                // Find the updated consignment for our current item
                const updatedConsignment = updatedConsignments.find((c: any) =>
                    c.lineItemIds.some((lineItemId: string) =>
                        lineItemId === getCurrentItem()?.id.toString() ||
                        lineItemId === String(getCurrentItem()?.id)
                    )
                );

                // Update our local item consignments with the updated data
                if (updatedConsignment) {
                    updateStoredConsignment(
                        updatedConsignment.id,
                        getCurrentItem().id,
                        getCurrentItem().quantity,
                        updatedConsignment.shippingAddress,
                        shippingOption.id
                    );
                }
            }

            // Handle localStorage for shipping options
            const storageKey = currentItem.id.toString();
            const existingData = localStorage.getItem(storageKey);
            const shippingData = {
                ...shippingOption,
                quantity: currentItem.quantity,
                productId: currentItem.productId,
                deliveryDateISO: deliveryDate.toISOString(),
                updatedAt: new Date().toISOString()
            };

            if (!existingData) {
                // Create new entry
                localStorage.setItem(storageKey, JSON.stringify(shippingData));
            } else {
                // Update existing entry
                const parsedData = JSON.parse(existingData);
                const updatedData = {
                    ...parsedData,
                    ...shippingData
                };
                localStorage.setItem(storageKey, JSON.stringify(updatedData));
            }

            await loadCheckout();
            await refreshCheckoutTotals();
            await fetchCartData();

        } catch (error) {
            console.error('Error updating shipping and delivery date:', error);
            setError(error instanceof Error ? error.message : 'An unexpected error occurred');
        } finally {
            setIsLoading(false);
        }
    };



    const handleFinalContinue = async () => {
        if (isLoading) return;

        setIsLoading(true);

        try {
            // Make sure all changes are synchronized with BigCommerce checkout state
            await refreshCheckoutTotals();
            await updateOrderSummaryDisplay();

            // Call navigateNextStep with the current billing/shipping relationship
            navigateNextStep(isBillingSameAsShipping);
        } catch (err) {
            if (err instanceof Error) {
                setError(err.message);
                setIsEditing(false);
                onUnhandledError(err);
            }
        } finally {
            setIsLoading(false);
        }
    };

    if (!physicalItems.length) {
        return <div>No physical items in cart</div>;
    }

    const currentItem = getCurrentItem();
    const currentConsignment = getCurrentConsignment();


    if (!currentItem) {
        return <div>Loading...</div>;
    }

    const handleDatePickerClick = () => {
        const currentItem = getCurrentItem();
        if (!currentItem) return;

        setIsDeliveryDateModalOpen(true);
        // const storageKey = currentItem.id.toString();
        // const localStorageData = localStorage.getItem(storageKey);

        // if (localStorageData) {
        //     try {
        //         const parsedData = JSON.parse(localStorageData);
        //         if (parsedData.giftMessage !== undefined) {
        //             setIsDeliveryDateModalOpen(true);
        //         } else {
        //             setError('Please add/skip the gift message by clicking the "Add Gift Message" button');
        //         }
        //     } catch (error) {
        //         setError('Please add/skip the gift message by clicking the "Add Gift Message" button');
        //     }
        // } else {
        //     setError('Please add/skip the gift message by clicking the "Add Gift Message" button');
        // }
    };




    const renderAddressSelection = () => {
        const checkout = getCheckout();
        const isGuest = !checkout || !checkout.customer || checkout.customer.id === 0;

        // For logged-in customers, show original address selection
        if (!isGuest) {
            return (
                <div className="tt-custom-address-select-container">
                    {customer.addresses.length > 0 ? (
                        <AddressSelect
                            addresses={customer.addresses}
                            selectedAddress={selectedAddress}
                            type={AddressType.Shipping}
                            onSelectAddress={handleAddressSelect}
                            onUseNewAddress={handleUseNewAddress}
                            placeholderText={<TranslatedString id="shipping.choose_shipping_address" />}
                            showSingleLineAddress
                        />
                    ) : (
                        <Button
                            onClick={handleUseNewAddress}
                            testId="add-new-address"
                            className="tt-add-button"
                        >
                            Add address
                        </Button>
                    )}
                </div>
            );
        }
        // For guest users, show saved address for current item or add button
        const currentItemAddress = currentItem ? itemGuestAddresses[currentItem.id.toString()] : null;

        return (
            <div className="tt-custom-address-select-container">
                {currentItemAddress ? (
                    <div className="tt-guest-address-display">
                        <div
                            className="tt-address-card"
                            onClick={() => handleAddressSelect(currentItemAddress)}
                        >
                            <div className="tt-address-content">
                                <div className="tt-address-name">
                                    {currentItemAddress.firstName} {currentItemAddress.lastName}
                                </div>
                                <div className="tt-address-line">
                                    {currentItemAddress.address1}
                                    {currentItemAddress.address2 && `, ${currentItemAddress.address2}`}
                                </div>
                                <div className="tt-address-city-state">
                                    {currentItemAddress.city}, {currentItemAddress.stateOrProvinceCode} {currentItemAddress.postalCode}
                                </div>
                            </div>

                        </div>
                        <button
                            className="tt-edit-address-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleEditGuestAddress();
                            }}
                            title="Edit address"
                        >
                            Edit
                        </button>
                    </div>
                ) : (
                    <Button
                        onClick={() => {
                            setIsEditingGuestAddress(false); // Make sure it's false for new address
                            handleUseNewAddress();
                        }}
                        testId="add-new-address"
                        className="tt-add-button"
                    >
                        Add address
                    </Button>
                )}
            </div>
        );
    };

    const getCurrentItemGuestAddress = () => {
        const currentItem = getCurrentItem();
        return currentItem && isEditingGuestAddress ? itemGuestAddresses[currentItem.id.toString()] : undefined;
    };


    const renderItem = (item: LineItem, index: number) => {
        const isConfigured = configuredItems[item.id];
        const isBeingEdited = currentItemIndex === index && !isConfigured;
        const consignment = itemConsignments.find(c => c.lineItemId === item.id);
        const showSplitButton = isBeingEdited &&
            !isConfigured &&
            item.quantity > 1 &&
            (!consignment || !consignment.id);
        const giftMessage = getItemOptions(item.id, "Gift Message")
        const hasGiftMessage = giftMessage && giftMessage != '_';

        // const showAddGiftMessageButton = !hasGiftMessage && !showSplitButton;
        // const currentConsignment = getCurrentConsignment();
        return (
            <div
                key={item.id}
                className={`tt-custom-item-wrapper ${isBeingEdited ? 'tt-custom-item-editing' : ''}`}

                data-item-id={item.id}
            >
                {/* Editing or Configured State */}
                {isBeingEdited ? (
                    <div className="tt-custom-item-editing-container">

                        {/* Column 1: Item Details */}
                        <div className="tt-custom-item-details-column">
                            <div className="tt-editing-column-header">ITEM</div>
                            {item.imageUrl && (
                                <img src={item.imageUrl} alt={item.name} className="tt-editing-item-image" />
                            )}
                            <div className="tt-editing-item-name">{item.name}</div>
                            <div className="tt-editing-item-sku">SKU: {item.sku}</div>
                            <div className="tt-editing-item-qty">Quantity: {item.quantity}</div>
                            {showSplitButton && (
                                <Button
                                    onClick={() => handleSplitLineItem(item.id, item.quantity)}
                                    variant={ButtonVariant.Secondary}
                                    className="tt-send-multiple-recipients-button"
                                    disabled={isLoading}
                                >
                                    Send to multiple recipients
                                </Button>
                            )}
                        </div>

                        {/* Column 2: Address Selection */}
                        <div className="tt-custom-address-selection">
                            <div className="tt-editing-column-header">DELIVERY ADDRESS</div>
                            {renderAddressSelection()}
                        </div>

                        {/* Column 3: Delivery Details */}
                        <div className="tt-custom-shipping-options">
                            <div className="tt-editing-column-header">SHIPPING METHOD</div>
                            {selectedShippingOption && getItemOptions(item.id, "Delivery Date") ? (
                                <div className="tt-delivery-details-content">
                                    <div className="tt-delivery-method-name">
                                        {(() => {
                                            let methodName = selectedShippingOption.description
                                                .split(' Delivers:')[0]
                                                .split(' Est.')[0]
                                                .trim();

                                            // Add closing parenthesis if it's missing
                                            if (methodName.includes('(') && !methodName.includes(')')) {
                                                methodName += ')';
                                            }

                                            return methodName;
                                        })()}
                                    </div>
                                    <div className="tt-delivery-cost">${selectedShippingOption.cost.toFixed(2)}</div>
                                    <div className="tt-delivery-date-display">
                                        Estimated Delivery: {getItemOptions(item.id, "Delivery Date")}
                                    </div>
                                    <div className="tt-delivery-date-display">
                                        Ship Date: {getItemOptions(item.id, "Ship Date")}
                                    </div>
                                    <a
                                        href="#"
                                        className="tt-edit-ship-link"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            handleDatePickerClick();
                                        }}
                                    >
                                        Edit
                                    </a>
                                </div>
                            ) : selectedAddress ? (
                                <button
                                    className="tt-add-button"
                                    onClick={handleDatePickerClick}
                                >
                                    Select Ship Date
                                </button>
                            ) : (
                                <div className="tt-empty-message">Select address first</div>
                            )}
                        </div>

                        {/* Column 4: Gift Message */}
                        <div className={`tt-custom-gift-message-container ${hasGiftMessage ? 'has-message' : ''}`}>
                            <div className="tt-editing-column-header">GIFT MESSAGE</div>
                            {hasGiftMessage ? (
                                <div className="tt-gift-message-content">
                                    <div className="tt-gift-message-display">{giftMessage}</div>
                                    <a
                                        href="#"
                                        className="tt-edit-link"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            handleEditGiftMessage(item.id, giftMessage || '');
                                        }}
                                    >
                                        Edit
                                    </a>
                                </div>
                            ) : getItemOptions(item.id, "Delivery Date") ? (
                                <button
                                    className="tt-add-button"
                                    onClick={() => handleAddGiftMessage(item.id)}
                                    disabled={isLoading}
                                >
                                    Add Gift Message
                                </button>
                            ) : (
                                <div className="tt-empty-message">Select delivery date first</div>
                            )}
                        </div>

                        {/* Error Alert */}
                        {error && (
                            <div className="tt-error-alert">
                                <Alert>{error}</Alert>
                            </div>
                        )}

                        {/* Continue Button */}
                        <div className="form-actions">
                            <Button
                                id={`checkout-shipping-continue-${item.id}`}
                                onClick={handleContinue}
                                disabled={
                                    isLoading ||
                                    !selectedAddress ||
                                    (currentConsignment &&
                                        currentConsignment.availableShippingOptions &&
                                        currentConsignment.availableShippingOptions.length > 0 &&
                                        !selectedShippingOption)
                                }
                                variant={ButtonVariant.Primary}
                                testId="checkout-shipping-continue"
                                className="optimizedCheckout-buttonPrimary"
                            >
                                {currentItemIndex < physicalItems.length - 1 ? (
                                    <span>Next</span>
                                ) : (
                                    <span>Continue</span>
                                )}
                            </Button>
                        </div>
                    </div>
                ) : isConfigured && consignment ? (
                    <div className="tt-custom-item-configured-container">
                        <div className="tt-configured-item-content">

                            {/* Column 1: Item Details */}
                            <div className="tt-configured-item-column">
                                <div className="tt-column-header">Item</div>
                                <div className="tt-configured-item-header">
                                    {item.imageUrl && (
                                        <img src={item.imageUrl} alt={item.name} className="tt-configured-item-image" />
                                    )}
                                    <div className="tt-configured-item-name">{item.name}</div>
                                     <div className="tt-configured-item-sku">SKU: {item.sku}</div>
                                    <div className="tt-configured-item-qty">Quantity: {item.quantity}</div>
                                    <button
                                        className="tt-configured-edit-button"
                                        onClick={() => handleEditConsignment(index)}
                                        disabled={
                                            isEditing &&
                                            currentItemIndex !== index &&
                                            !configuredItems[physicalItems[index].id]
                                        }
                                    >
                                        Edit
                                    </button>
                                </div>
                            </div>

                            {/* Column 2: Delivery Address */}
                            <div className="tt-configured-item-column">
                                <div className="tt-column-header">Delivery Address</div>
                                {consignment?.shippingAddress && (
                                    <div className="tt-configured-address-section">
                                        <div className="tt-configured-address-line tt-configured-address-name">
                                            {consignment.shippingAddress.firstName} {consignment.shippingAddress.lastName}
                                        </div>
                                        <div className="tt-configured-address-line">
                                            {consignment.shippingAddress.address1}
                                        </div>
                                        {consignment.shippingAddress.address2 && (
                                            <div className="tt-configured-address-line">
                                                {consignment.shippingAddress.address2}
                                            </div>
                                        )}
                                        <div className="tt-configured-address-line">
                                            {consignment.shippingAddress.city}, {consignment.shippingAddress.stateOrProvinceCode}
                                        </div>
                                        <div className="tt-configured-address-line">
                                            {consignment.shippingAddress.postalCode}
                                        </div>
                                        {consignment.shippingAddress.phone && (
                                            <div className="tt-configured-address-line">
                                                {consignment.shippingAddress.phone}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Column 3: Delivery Details */}
                            <div className="tt-configured-item-column">
                                <div className="tt-column-header">Shipping Method</div>
                                <div className="tt-configured-delivery-section">
                                    {consignment?.selectedShippingOption && (
                                        <div className="tt-configured-shipping-method">
                                            {(() => {
                                                let methodName = consignment.selectedShippingOption.description
                                                    .split(' Delivers:')[0]
                                                    .split(' Est.')[0]
                                                    .trim();

                                                // Add closing parenthesis if it's missing
                                                if (methodName.includes('(') && !methodName.includes(')')) {
                                                    methodName += ')';
                                                }

                                                return methodName;
                                            })()}
                                        </div>
                                    )}
                                    {consignment?.selectedShippingOption && (
                                        <div className="tt-configured-shipping-method">
                                            ${consignment.selectedShippingOption.cost.toFixed(2)}
                                        </div>
                                    )}
                                    {getItemOptions(item.id, "Delivery Date") && (
                                        <div className="tt-configured-delivery-date">
                                            <span className="tt-custom-delivery-date-label">Estimated Delivery:</span>
                                            <span className="tt-custom-delivery-date-value">{getItemOptions(item.id, "Delivery Date")}</span>
                                        </div>
                                    )}
                                    {getItemOptions(item.id, "Ship Date") && (
                                        <div className="tt-configured-delivery-date">
                                            <span className="tt-custom-delivery-date-label">Ship Date:</span>
                                            <span className="tt-custom-delivery-date-value">{getItemOptions(item.id, "Ship Date")}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Column 4: Gift Message */}
                            <div className="tt-configured-item-column">
                                <div className="tt-column-header">Gift Message</div>
                                <div className="tt-configured-gift-section">
                                    {hasGiftMessage ? (
                                        <div className="tt-configured-gift-message-text">{giftMessage}</div>
                                    ) : (
                                        <div className="tt-configured-gift-message-text">No message</div>
                                    )}
                                </div>
                            </div>

                        </div>
                    </div>
                ) : (
                    <div className="tt-custom-item-placeholder-container">
                        <div className="tt-placeholder-item-content">

                            {/* Column 1: Item Details */}
                            <div className="tt-placeholder-item-column">
                                <div className="tt-placeholder-column-header">ITEMS</div>
                                <div className="tt-placeholder-item-details">
                                    {item.imageUrl && (
                                        <img src={item.imageUrl} alt={item.name} className="tt-placeholder-item-image" />
                                    )}
                                    <div className="tt-placeholder-item-name">{item.name}</div>
                                    <div className="tt-placeholder-item-qty">SKU: {item.sku}</div>
                                    <div className="tt-placeholder-item-qty">Quantity: {item.quantity}</div>
                                    
                                </div>
                            </div>

                            {/* Column 2: Delivery Address */}
                            <div className="tt-placeholder-item-column">
                                <div className="tt-placeholder-column-header">DELIVERY ADDRESS</div>
                                <div className="tt-placeholder-empty-content">
                                    <div className="tt-placeholder-text">Address not selected</div>
                                </div>
                            </div>

                            {/* Column 3: Delivery Details */}
                            <div className="tt-placeholder-item-column">
                                <div className="tt-placeholder-column-header">SHIPPING</div>
                                <div className="tt-placeholder-empty-content">
                                    <div className="tt-placeholder-text">Shipping detaqils not selected</div>
                                </div>
                            </div>

                            {/* Column 4: Gift Message */}
                            <div className="tt-placeholder-item-column">
                                <div className="tt-placeholder-column-header">GIFT MESSAGE</div>
                                <div className="tt-placeholder-empty-content">
                                    <div className="tt-placeholder-text">No gift message</div>
                                </div>
                            </div>

                        </div>
                    </div>
                )
                }
            </div >
        );
    };


    return (
        <div className="checkout-form">
            <LoadingOverlay isLoading={isLoading || isLoadingDates || isInitializing}>
                <div className="tt-custom-shipping-container">
                    {/* Error and Address Form Modals (keep existing) */}
                    <ErrorModal
                        error={createCustomerAddressError}
                        message={
                            <>AddressFormModal
                                <TranslatedString id="address.consignment_address_updated_text" />{' '}
                                <TranslatedString id="customer.create_address_error" />
                            </>
                        }
                        onClose={handleCloseErrorModal}
                        shouldShowErrorCode={false}
                    />

                    <AddressFormModal
                        countries={filteredCountries}
                        countriesWithAutocomplete={countriesWithAutocomplete || ['US', 'CA', 'AU', 'NZ', 'GB']}
                        defaultCountryCode={selectedAddress?.countryCode || customer?.addresses?.[0]?.countryCode}
                        getFields={getFields || (() => [])}
                        googleMapsApiKey={googleMapsApiKey || ''}
                        isFloatingLabelEnabled={isFloatingLabelEnabled}
                        isLoading={isLoading}
                        isOpen={isAddAddressModalOpen}
                        onRequestClose={handleCloseAddAddressForm}
                        onSaveAddress={handleSaveAddress}
                        shouldShowSaveAddress={true}
                        address={getCurrentItemGuestAddress()}
                    />

                    <GiftMessageModal
                        isOpen={isEditGiftMessageModalOpen}
                        isLoading={isLoading}
                        initialMessage={editedGiftMessage}
                        onSubmit={handleSubmitGiftMessage}
                        onRequestClose={() => {
                            setIsEditGiftMessageModalOpen(false);
                            setEditedGiftMessage('');  // Clear the message when closing
                        }}
                    />

                    <DeliveryDateModal
                        isOpen={isDeliveryDateModalOpen}
                        isLoading={isLoading || isLoadingDates}
                        currentConsignment={currentConsignment}
                        product={currentItem}
                        selectedShippingOption={selectedShippingOption}
                        selectedShippingDate={selectedShippingDate}
                        selectedDeliveryDate={selectedDeliveryDate}
                        onSubmit={handleDeliveryDateSubmit}
                        onRequestClose={() => setIsDeliveryDateModalOpen(false)}
                        isDatePickerMode={true} // Set this when opening from date picker
                    />

                    {/* Render all items in original order */}
                    <div className="tt-custom-items-container">
                        {getOrderedPhysicalItems().map((item, index) => renderItem(item, index))}
                    </div>

                    {/* Final Continue Button */}
                    {allItemsConfigured && (
                        <div className="form-actions">
                            <Button
                                id="checkout-shipping-final-continue"
                                onClick={handleFinalContinue}
                                variant={ButtonVariant.Primary}
                                className="optimizedCheckout-buttonPrimary"
                            >
                                Continue
                            </Button>
                        </div>
                    )}
                </div>
            </LoadingOverlay>
        </div>
    );
};

export default CustomShipping;