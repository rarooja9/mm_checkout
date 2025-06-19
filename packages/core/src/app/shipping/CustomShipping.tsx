import React, { FunctionComponent, useState, useEffect } from 'react';
import { Button, ButtonVariant } from '../ui/button';
import { LoadingOverlay } from '../ui/loading';
import { Alert } from '../ui/alert';
import { TranslatedString } from '@bigcommerce/checkout/locale';
import { useCheckout } from "@bigcommerce/checkout/payment-integration-api";
import DatePicker from 'react-datepicker';
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

interface ShippingDate {
    display: string;
    iso: string;
    value: number;
}

interface ShippingDateResponse {
    availableDates?: ShippingDate[];
    methods?: Array<{
        method: string;
        availableDates: ShippingDate[];
    }>;
}

export interface LineItem {
    id: string | number;
    name: string;
    imageUrl?: string;
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
    const [isLoadingShippingOptions, setIsLoadingShippingOptions] = useState(false);

    // Add originalItemOrder state to maintain the display order
    const [originalItemOrder, setOriginalItemOrder] = useState<string[]>([]);

    const [isEditGiftMessageModalOpen, setIsEditGiftMessageModalOpen] = useState(false);
    const [currentGiftMessageItemId, setCurrentGiftMessageItemId] = useState<string | number | null>(null);
    const [editedGiftMessage, setEditedGiftMessage] = useState('');

    const [availableShippingDates, setAvailableShippingDates] = useState<Date[]>([]);
    const [selectedShippingDate, setSelectedShippingDate] = useState<Date | null>(null);
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

                // PARALLEL FETCH: Cart data and checkout data simultaneously
                const [cartItemsWithOptions, checkoutResponse] = await Promise.all([
                    fetchCartData(),
                    fetch(
                        `/api/storefront/checkouts/${checkout.id}?include=consignments.availableShippingOptions,cart.lineItems.physicalItems.options`,
                        {
                            method: 'GET',
                            headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
                        }
                    )
                ]);

                if (!checkoutResponse.ok) {
                    throw new Error('Failed to fetch checkout data');
                }

                const checkoutData = await checkoutResponse.json();

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

                    // After deleting multi-item consignments, reload checkout
                    await loadCheckout();

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

                    // Reload checkout after restorations
                    await loadCheckout();

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
                    await loadCheckout();
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

                // Set up configured items map
                const configuredItemsMap: { [key: string]: boolean } = {};

                // OPTIMIZATION: Check all configurations in parallel
                const configurationPromises = initialConsignments.map(async (consignment) => {
                    const hasAddressAndShipping = Boolean(
                        consignment.shippingAddress && consignment.selectedShippingOption
                    );

                    const hasValidDeliveryDateValue = await hasValidOptionValue(consignment.lineItemId, "Delivery Date");

                    return {
                        lineItemId: consignment.lineItemId,
                        isConfigured: hasAddressAndShipping && hasValidDeliveryDateValue
                    };
                });

                const configurationResults = await Promise.all(configurationPromises);
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
            setSelectedShippingDate(null); // Clear previous selected date
            setAvailableShippingDates([]); // Clear available dates

            setIsLoading(true);
            try {
                // Load the latest checkout data
                await loadCheckout();

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

                        await fetchCartData(); // Ensure cart data is loaded
                        const deliveryDate = getItemDeliveryDate(currentItem.id);

                        if (deliveryDate) {
                            try {
                                const dateParts = deliveryDate.split('/');
                                if (dateParts.length === 3) {
                                    const month = parseInt(dateParts[0]) - 1; // JS months are 0-indexed
                                    const day = parseInt(dateParts[1]);
                                    const year = parseInt(dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2]);

                                    const dateObj = new Date(year, month, day);

                                    if (!isNaN(dateObj.getTime()) && availableShippingDates.length > 0) {
                                        const exactMatch = availableShippingDates.find(date =>
                                            date.getFullYear() === dateObj.getFullYear() &&
                                            date.getMonth() === dateObj.getMonth() &&
                                            date.getDate() === dateObj.getDate()
                                        );

                                        if (exactMatch) {
                                            setSelectedShippingDate(exactMatch);
                                        } else {
                                            // Fall back to closest date if no exact match
                                            const closestDate = availableShippingDates.reduce((prev, curr) => {
                                                return (Math.abs(curr.getTime() - dateObj.getTime()) <
                                                    Math.abs(prev.getTime() - dateObj.getTime()))
                                                    ? curr : prev;
                                            });
                                            setSelectedShippingDate(closestDate);
                                        }
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

                    // Check if the item has a valid delivery date
                    const hasDeliveryDate = await hasValidOptionValue(item.id, "Delivery Date");

                    // Item is fully configured only if both conditions are met
                    return isBasicConfigured && hasDeliveryDate;
                })
            );

            // Check if all items are configured
            const allConfigured = configurationChecks.every(isConfigured => isConfigured);
            setAllItemsConfigured(allConfigured);
        };

        checkAllItemsConfigured();
    }, [physicalItems, configuredItems, cartItems]);

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

    // Handle shipping option selection- currently not in use
    const handleShippingOptionSelect = async (option: any) => {
        setSelectedShippingOption(option);
        setIsLoading(true);

        try {
            // Get current consignment from our local state
            const currentConsignment = getCurrentConsignment();
            const currentItem = getCurrentItem();

            if (currentConsignment && currentConsignment.id) {
                // Use direct API call to update shipping option
                const result = await updateConsignmentShippingOption(currentConsignment.id, option.id);

                // Fetch available dates
                const dates = await fetchShippingDates(
                    selectedAddress,
                    currentItem.id,
                    option.method || option.description
                );

                // Set the available dates in state
                setAvailableShippingDates(dates);

                // Reset selected date when shipping option changes
                setSelectedShippingDate(null);

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
                        option.id
                    );
                    const newItemConsignments = [...itemConsignments];
                    const currentIndex = newItemConsignments.findIndex(c => c.lineItemId === getCurrentItem()?.id);

                    if (currentIndex >= 0) {
                        newItemConsignments[currentIndex] = {
                            ...newItemConsignments[currentIndex],
                            id: updatedConsignment.id,
                            selectedShippingOption: updatedConsignment.selectedShippingOption,
                        };

                        setItemConsignments(newItemConsignments);
                    }
                }

                // Synchronize the checkout state with the changes made via direct API
                await refreshCheckoutTotals();
            } else {
                // Fallback update for local state if needed
                const updatedConsignments = [...itemConsignments];
                const currentIndex = updatedConsignments.findIndex(c => c.lineItemId === getCurrentItem()?.id);

                if (currentIndex >= 0) {
                    updatedConsignments[currentIndex] = {
                        ...updatedConsignments[currentIndex],
                        selectedShippingOption: option,
                    };

                    setItemConsignments(updatedConsignments);
                }
            }
            await updateOrderSummaryDisplay();
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
        setAvailableShippingDates([]);

        // console.log('address', address);
        setSelectedAddress(address);
        setIsLoading(true);
        setIsLoadingShippingOptions(true);
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
            setIsLoadingShippingOptions(false);
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
            const options = {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache, no-store'
                }
            };

            // This direct API call forces BigCommerce to recalculate all shipping totals
            // but does NOT auto-select shipping options
            await fetch(`/api/storefront/checkouts/${checkout.id}?include=cart.lineItems.physicalItems.options,consignments.availableShippingOptions`, options);

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

            // 4. Build option selections preserving existing options
            const currentOptions = cartItem.options || [];
            const optionSelections = currentOptions.map((option: { nameId: any; value: any; valueId: any; }) => ({
                optionId: option.nameId,
                optionValue: option.valueId || option.value
            }));

            // 5. Update/add delivery date option
            if (productOptions.deliveryDate && parsedLocalData.deliveryDate) {
                const deliveryDateIndex = optionSelections.findIndex(
                    (option: { optionId: any; }) => option.optionId === productOptions.deliveryDate
                );

                // Format delivery date as mm/dd/yyyy
                const deliveryDate = new Date(parsedLocalData.deliveryDate);
                const formattedDeliveryDate = deliveryDate.toLocaleDateString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    year: 'numeric'
                });

                if (deliveryDateIndex >= 0) {
                    optionSelections[deliveryDateIndex].optionValue = formattedDeliveryDate;
                } else {
                    optionSelections.push({
                        optionId: productOptions.deliveryDate,
                        optionValue: formattedDeliveryDate
                    });
                }
            }

            // 6. Update/add ship date option
            if (productOptions.shipDate && parsedLocalData.dispatchDate) {
                const shipDateIndex = optionSelections.findIndex(
                    (option: { optionId: any; }) => option.optionId === productOptions.shipDate
                );

                // Format dispatch date as mm/dd/yyyy
                const dispatchDate = new Date(parsedLocalData.dispatchDate);
                const formattedDispatchDate = dispatchDate.toLocaleDateString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    year: 'numeric'
                });

                if (shipDateIndex >= 0) {
                    optionSelections[shipDateIndex].optionValue = formattedDispatchDate;
                } else {
                    optionSelections.push({
                        optionId: productOptions.shipDate,
                        optionValue: formattedDispatchDate
                    });
                }
            }

            // 7. Update/add gift message option
            if (productOptions.giftMessage && parsedLocalData.giftMessage !== undefined) {
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

            // 8. Get checkout for cart update
            const checkout = getCheckout();
            if (!checkout) {
                throw new Error('Checkout not available');
            }

            // 9. Update the cart item with new options
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
            await loadCheckout();
            await updateOrderSummaryDisplay();

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
            } else {
                // For guest customers, don't save the address
                address.shouldSaveAddress = false;
            }

            // Create the customer address first using the service from useCheckout hook
            if (createCustomerAddress && address.shouldSaveAddress) {
                try {
                    await createCustomerAddress(address);
                } catch (error) {
                    if (error instanceof Error) {
                        setCreateCustomerAddressError(error);
                    }
                }
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

        // Create a specific update to force recalculation of shipping totals in UI
        const options = {
            method: 'PUT',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            // We're not actually changing anything, just forcing a UI refresh
            body: JSON.stringify({
                // Include customerMessage to avoid mutations being ignored
                customerMessage: checkout.customerMessage || ''
            })
        };

        try {
            await fetch(`/api/storefront/checkouts/${checkout.id}`, options);

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
            await loadCheckout();


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
                await loadCheckout();

                return await response.json();
            }
        } catch (error) {
            console.error('Error restoring consignment:', error);
            throw error;
        }
    };

    const fetchShippingDates = async (
        address: Address,
        lineItemId: string | number,
        shippingMethod: string
    ) => {
        try {
            const checkout = getCheckout();
            if (!checkout) {
                throw new Error('Checkout not available');
            }

            const requestBody = {
                cartId: checkout.id,
                itemId: lineItemId.toString(),
                quantity: 1,
                shippingMethod: shippingMethod,
                address: {
                    country: address.countryCode,
                    region: address.stateOrProvinceCode,
                    city: address.city,
                    zipcode: address.postalCode
                }
            };

            const response = await fetch('https://bc-middleware-mm.onrender.com/get-dates', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error('Failed to fetch shipping dates');
            }

            const dateData: ShippingDateResponse = await response.json();

            // First, check if there are method-specific dates
            let matchedDates: { display: string; iso: string; value: number }[] = [];


            if (dateData.methods) {
                const methodMatch = dateData.methods.find(m =>
                    shippingMethod.toLowerCase().includes(m.method.toLowerCase())
                );

                if (methodMatch) {
                    matchedDates = methodMatch.availableDates;
                }
            }

            // If no method-specific dates, fall back to general available dates
            if (matchedDates.length === 0 && dateData.availableDates) {
                matchedDates = dateData.availableDates;
            }

            // If still no dates, generate default dates
            if (matchedDates.length === 0) {
                const defaultDates = generateDefaultDates();
                matchedDates = defaultDates.map(date => ({
                    display: date.toLocaleDateString(),
                    iso: date.toISOString().split('T')[0],
                    value: date.getTime()
                }));
            }

            // Return the matched dates without setting state
            return matchedDates.map(dateObj => new Date(dateObj.value));
        } catch (error) {
            console.error('Error fetching shipping dates:', error);

            // Fallback to default dates
            const defaultDates = generateDefaultDates();
            return defaultDates;
        }
    };

    // Function to generate default dates if no specific dates are available
    const generateDefaultDates = () => {
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() + 2); // Start from 2 days from now

        const dates: Date[] = [];
        const endDate = new Date(today);
        endDate.setMonth(today.getMonth() + 1, 30); // 1.5 months from now

        while (startDate <= endDate) {
            // Exclude weekends if needed
            if (startDate.getDay() !== 0 && startDate.getDay() !== 6) {
                dates.push(new Date(startDate));
            }
            startDate.setDate(startDate.getDate() + 1);
        }

        return dates;
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
    const handleDateSelection = async (date: Date) => {
        setSelectedShippingDate(date);
        setIsLoading(true);

        try {
            const checkout = getCheckout();
            if (!checkout) {
                throw new Error('Checkout not available');
            }

            const currentItem = getCurrentItem();
            //    console.log('currentItem', currentItem)
            if (!currentItem) {
                throw new Error('No current item selected');
            }

            // Format date as mm/dd/yyyy
            const formattedDate = date.toLocaleDateString('en-US', {
                month: '2-digit',
                day: '2-digit',
                year: 'numeric'
            });

            // Step 1: Get the option ID for Delivery Date
            const modifierResponse = await fetch('https://bc-middleware-mm.onrender.com/cart/get-modifier', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    cartId: checkout.id,
                    itemId: currentItem.id.toString()
                })
            });

            if (!modifierResponse.ok) {
                throw new Error('Failed to get delivery date option ID');
            }

            const modifierData = await modifierResponse.json();
            const deliveryDateOptionId = modifierData.id;

            if (!deliveryDateOptionId) {
                // If no option ID found, just set the date in state and return
                console.log('No delivery date option ID found, skipping update');
                return date;
            }

            const options = {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                }
            };

            const cartResponse = await fetch('/api/storefront/carts?include=lineItems.physicalItems.options', options);

            if (!cartResponse.ok) {
                throw new Error('Failed to fetch cart data');
            }

            const cartData = await cartResponse.json();

            const cartItem = cartData[0]?.lineItems.physicalItems.find(
                (item: { id: any; }) => item.id === currentItem.id
            );

            if (!cartItem || !cartItem.options) {
                throw new Error('Failed to retrieve item options');
            }

            // Build option selections array preserving all existing options
            const optionSelections = cartItem.options.map((option: { nameId: any; value: any; valueId: any; }) => ({
                optionId: option.nameId,
                optionValue: option.valueId || option.value
            }));

            // Find and update or add the delivery date option
            const deliveryDateIndex = optionSelections.findIndex(
                (option: { optionId: any; }) => option.optionId === deliveryDateOptionId
            );

            if (deliveryDateIndex >= 0) {
                // Update existing delivery date option
                optionSelections[deliveryDateIndex].optionValue = formattedDate;
            } else {
                // Add delivery date option if it doesn't exist
                optionSelections.push({
                    optionId: deliveryDateOptionId,
                    optionValue: formattedDate
                });
            }

            // Step 2: Update the cart item with the delivery date
            const updateOptions = {
                method: 'PUT',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    lineItem: {
                        productId: currentItem.productId,
                        variantId: currentItem.variantId,
                        quantity: currentItem.quantity,
                        optionSelections: optionSelections
                    }
                })
            };
            //     console.log('updateOptions', updateOptions)
            const updateResponse = await fetch(`/api/storefront/carts/${checkout.id}/items/${currentItem.id}`, updateOptions);

            if (!updateResponse.ok) {
                throw new Error('Failed to update delivery date');
            }

            // Step 3: Restore consignments similar to handleSubmitGiftMessage
            // Fetch updated checkout to get consignments
            const checkoutOptions = {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            };

            const checkoutResponse = await fetch(
                `/api/storefront/checkouts/${checkout.id}?include=consignments.availableShippingOptions`,
                checkoutOptions
            );

            if (!checkoutResponse.ok) {
                throw new Error('Failed to fetch updated checkout');
            }

            const result = await checkoutResponse.json();
            const currentConsignments = result.consignments || [];

            // Process consignments similar to splitLineItem logic
            for (const item of itemConsignments) {

                // Find the corresponding physical item to get its exact quantity
                const physicalItem = physicalItems.find(
                    physItem => physItem.id.toString() === item.lineItemId.toString()
                );

                // Get the quantity dynamically
                const itemQuantity = physicalItem ? physicalItem.quantity : 1;

                // Check if this item already has a consignment
                const existingConsignment = currentConsignments.find((c: any) =>
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

            // Merge consignments logic (similar to splitLineItem)
            const mergeConsignments = (existingConsignments: ConsignmentWithItem[], newConsignments: any[]) => {
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

            // Update item consignments
            setItemConsignments(prevConsignments =>
                mergeConsignments(prevConsignments, currentConsignments)
            );

            // Update configured items state
            const newConfiguredItems = { ...configuredItems };
            itemConsignments.forEach((consignment: {
                lineItemId: string | number;
                shippingAddress?: any;
                selectedShippingOption?: any;
            }) => {
                // Skip the current item being edited to keep it in editing state
                if (consignment.lineItemId === currentItem.id) {
                    return;
                }

                const isFullyConfigured =
                    consignment.shippingAddress &&
                    Object.keys(consignment.shippingAddress).length > 0 &&
                    consignment.selectedShippingOption;

                const hasDeliveryDate = hasValidOptionValue(consignment.lineItemId, "Delivery Date");
                const isCompletelyConfigured = isFullyConfigured && hasDeliveryDate;

                if (newConfiguredItems[consignment.lineItemId] !== isCompletelyConfigured) {
                    newConfiguredItems[consignment.lineItemId] = isCompletelyConfigured;
                }
            });

            setConfiguredItems(newConfiguredItems);

            // Reload checkout to sync state
            await loadCheckout();

            // Refresh checkout totals
            await refreshCheckoutTotals();

            // Update configured items state based on delivery date
            await fetchCartData();
            return date;
        } catch (error) {
            console.error('Error updating delivery date:', error);
            setError(error instanceof Error ? error.message : 'An unexpected error occurred');
            return date;
        } finally {
            setIsLoading(false);
        }
    };

    // Helper function to update the configured items state
    // const updateConfiguredItemsState = () => {
    //     const newConfiguredItems = { ...configuredItems };

    //     itemConsignments.forEach(consignment => {
    //         const hasAddressAndShipping =
    //             consignment.shippingAddress &&
    //             Object.keys(consignment.shippingAddress).length > 0 &&
    //             consignment.selectedShippingOption;

    //         const hasDeliveryDate = hasValidDeliveryDate(consignment.lineItemId);

    //         newConfiguredItems[consignment.lineItemId] = hasAddressAndShipping && hasDeliveryDate;
    //     });

    //     setConfiguredItems(newConfiguredItems);
    // };

    const getItemDeliveryDate = (itemId: string | number): string | null => {
        const cartItem = cartItems.find(item => item.id === itemId);

        if (!cartItem || !cartItem.options || !Array.isArray(cartItem.options)) {
            return null;
        }

        const deliveryDateOption = cartItem.options.find((option: any) =>
            option.name === "Delivery Date" || option.name.includes("Delivery Date")
        );

        return deliveryDateOption?.value || null;
    };

    const getItemOptions = (itemId: string | Number, optionName: string) => {
        let optionValue = ""
        const itemDetailsString = localStorage.getItem(itemId.toString());
        if (itemDetailsString) {
            try {
                const itemDetails: any = JSON.parse(itemDetailsString);
                const optionId = optionName === "Delivery Date" ? "deliveryDate" : "giftMessage";

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
            setAvailableShippingDates([]);

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

                                await fetchCartData();
                                const deliveryDate = getItemDeliveryDate(itemId);

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
                                                setSelectedShippingDate(dateObj);
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

    const fetchAndSetDates = async () => {
        if (!selectedAddress || !selectedShippingOption || !getCurrentItem()) return;

        const currentConsignment = getCurrentConsignment();
        if (!currentConsignment) return;

        // Safely access availableShippingOptions
        if (!currentConsignment.availableShippingOptions ||
            currentConsignment.availableShippingOptions.length === 0) {
            setError("No shipping options available");
            return;
        }

        // Find the full shipping option details
        const fullShippingOption = currentConsignment.availableShippingOptions.find(
            option => option.id === selectedShippingOption.id
        );

        if (!fullShippingOption) {
            setError("Selected shipping option not found");
            return;
        }

        setIsLoading(true);
        try {
            const dates = await fetchShippingDates(
                selectedAddress,
                getCurrentItem().id,
                fullShippingOption.description
            );
            setAvailableShippingDates(dates);
        } catch (error) {
            console.error("Error fetching dates:", error);
            setError("Failed to load delivery dates. Please try again.");
        } finally {
            setIsLoading(false);
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


    const renderDatePickerInput = () => {
        const formattedDate = selectedShippingDate
            ? selectedShippingDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            })
            : '';
        const shippingDescription = (selectedShippingOption && selectedShippingOption.description) || '';

        let inputPlaceholder = '';
        if (shippingDescription && formattedDate) {
            inputPlaceholder = shippingDescription + ' ' + formattedDate
        }
        else {
            inputPlaceholder = 'Select a Estimated Delivery Date'
        }

        return (
            <div className="form-field delivery-date-picker-field">
                <label className="form-label">Estimated Delivery Date</label>
                <div
                    className="form-input date-picker-input"
                    onClick={() => setIsDeliveryDateModalOpen(true)}
                >
                    <div className="date-picker-display">
                        {inputPlaceholder}
                    </div>
                    <span className="date-picker-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                    </span>
                </div>
            </div>
        );
    };

    const renderShippingAndDeliverySection = () => {
        if (!selectedAddress) {
            return null;
        }

        if (isLoadingShippingOptions) {
            return null; // Don't display anything while loading shipping options
        }

        const currentConsignment = getCurrentConsignment();
        const hasShippingOptions = currentConsignment &&
            currentConsignment.availableShippingOptions &&
            currentConsignment.availableShippingOptions.length > 0;
        if (!hasShippingOptions) {
            return (
                <div className="tt-custom-no-shipping-options">
                    Due to state restrictions, we cannot ship fruit to California or alcohol to Arizona, Indiana, Kentucky, Michigan, Mississippi, North Dakota, Tennessee or Utah
                </div>
            );
        }
        else {
            return (<>{renderDatePickerInput()}</>)
        }
        // If we have selected a shipping option, show options and date picker
        if (selectedShippingOption) {
            return (
                <div className="tt-custom-shipping-options">
                    <h4 className="optimizedCheckout-headingSecondary">
                        Shipping Method
                    </h4>

                    <div className="selected-shipping-option">
                        <div className="option-description">{selectedShippingOption.description}</div>
                        <div className="option-cost">${selectedShippingOption.cost.toFixed(2)}</div>
                        <Button
                            onClick={() => setIsDeliveryDateModalOpen(true)}
                            variant={ButtonVariant.Secondary}
                            className="edit-shipping-btn"
                        >
                            Change
                        </Button>
                    </div>

                    {/* Date picker input */}
                    {renderDatePickerInput()}
                </div>
            );
        }
        //Because we have dependancy we're keeping this function
        else if (false) {
            return (
                <div className="tt-custom-shipping-options">
                    <h4 className="optimizedCheckout-headingSecondary">
                        Shipping Method
                    </h4>

                    {/* Original renderShippingOptions content */}
                    {renderShippingOptions()}
                </div>
            );
        }

    };

    const renderShippingOptions = () => {
        const currentConsignment = getCurrentConsignment();

        return (
            <>
                {selectedAddress && currentConsignment && currentConsignment.availableShippingOptions && currentConsignment.availableShippingOptions.length > 0 ? (
                    <div className="tt-custom-shipping-options-list">
                        {currentConsignment.availableShippingOptions.map(option => (
                            <div
                                key={option.id}
                                className={`tt-custom-shipping-option ${selectedShippingOption?.id === option.id ? 'selected' : ''}`}
                                onClick={() => handleShippingOptionSelect(option)}
                            >
                                <input
                                    type="radio"
                                    name="shippingOption"
                                    id={`${getCurrentItem()?.id}-${option.id}`}
                                    checked={selectedShippingOption?.id === option.id}
                                    onChange={() => handleShippingOptionSelect(option)}
                                />
                                <label htmlFor={`${getCurrentItem()?.id}-${option.id}`}>
                                    <div className="tt-custom-option-description">{option.description}</div>
                                    <div className="tt-custom-option-cost">${option.cost.toFixed(2)}</div>
                                    {option.transitTime && <div className="tt-custom-option-transit">{option.transitTime}</div>}
                                </label>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="tt-custom-no-shipping-options">
                        No shipping options available for this address
                    </div>
                )}

                {/* Date Picker */}
                {selectedShippingOption && (
                    <div className="tt-custom-shipping-date-picker" style={{ marginTop: '1rem' }} >
                        <h4 className="optimizedCheckout-headingSecondary" style={{ marginBottom: '0.5rem' }} >
                            Select Delivery Date
                        </h4>

                        {availableShippingDates.length > 0 ? (
                            <div className="tt-delivery-date-picker">
                                <DatePicker
                                    selected={selectedShippingDate}
                                    onChange={(date: Date) => handleDateSelection(date)}
                                    includeDates={availableShippingDates}
                                    minDate={availableShippingDates[0]}
                                    maxDate={availableShippingDates[availableShippingDates.length - 1]}
                                    placeholderText="Select a delivery date"
                                    className="tt-delivery-date-input"
                                    calendarClassName="tt-delivery-date-calendar"
                                    popperClassName="tt-delivery-date-popper"
                                />
                            </div>
                        ) : (
                            <div className="tt-loading-dates">
                                <Button
                                    onClick={() => fetchAndSetDates()}
                                    variant={ButtonVariant.Secondary}
                                    disabled={isLoading}
                                >
                                    Load Delivery Dates
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </>
        );
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
        const showAddGiftMessageButton = !hasGiftMessage && !showSplitButton;
        const currentConsignment = getCurrentConsignment();
        return (
            <div
                key={item.id}
                className={`tt-custom-item-wrapper ${isBeingEdited ? 'tt-custom-item-editing' : ''}`}

                data-item-id={item.id}
            >
                {/* Item Image and Basic Details - Always Visible */}
                <div className="tt-custom-item-base-info">
                    <div className="tt-custom-item-image-container">
                        {item.imageUrl && (
                            <img src={item.imageUrl} alt={item.name} className="tt-custom-item-image" />
                        )}
                    </div>
                    <div className="tt-custom-item-details">
                        <span className="tt-custom-item-name">{item.name}</span>
                        <span className="tt-custom-item-quantity">Quantity: {item.quantity}</span>
                    </div>
                </div>

                {/* Editing or Configured State */}
                {isBeingEdited ? (
                    <div className="tt-custom-item-editing-container">
                        {/* Address Selection */}
                        <div className="tt-custom-address-selection">
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
                            {/* Show Add Gift Message Button in Edit Mode */}
                            {showAddGiftMessageButton && (
                                <Button
                                    onClick={() => handleAddGiftMessage(item.id)}
                                    variant={ButtonVariant.Secondary}
                                    className="tt-add-gift-message-button"
                                    disabled={isLoading}
                                >
                                    Add Gift Message
                                </Button>
                            )}

                            {/* Display Existing Gift Message in Edit Mode */}
                            {hasGiftMessage && (
                                <div className="tt-custom-gift-message-container">
                                    <h4 className="tt-custom-gift-message-head">
                                        Gift Message
                                    </h4>
                                    <div className="tt-custom-gift-message">
                                        <div className="tt-custom-gift-message-text">{giftMessage}</div>
                                        <a
                                            href="#"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                handleEditGiftMessage(item.id, giftMessage || '');
                                            }}
                                            className="tt-edit-gift-message-link"
                                        >
                                            Edit
                                        </a>
                                    </div>
                                </div>
                            )}
                            <h4 className="optimizedCheckout-headingSecondary">
                                Shipping Address
                            </h4>
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
                                        variant={ButtonVariant.Secondary}
                                        className="optimizedCheckout-buttonSecondary"
                                    >
                                        Add address
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Shipping Options */}
                        {selectedAddress && renderShippingAndDeliverySection()}


                        {/* Error Alert */}
                        {error && (
                            <Alert>
                                {error}
                            </Alert>
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
                        <div className="tt-custom-item-address">
                            {consignment?.shippingAddress && (
                                <div>
                                    <span className="tt-custom-address-name">
                                        {consignment.shippingAddress.firstName} {consignment.shippingAddress.lastName}
                                    </span>
                                    <span className="tt-custom-address-line">
                                        {consignment.shippingAddress.address1}
                                    </span>
                                    <span className="tt-custom-address-city-state">
                                        {consignment.shippingAddress.city}, {consignment.shippingAddress.stateOrProvinceCode} {consignment.shippingAddress.postalCode}
                                    </span>
                                </div>
                            )}
                        </div>
                        <div className="tt-custom-item-shipping-method">
                            {consignment?.selectedShippingOption && (
                                <span>
                                    {consignment.selectedShippingOption.description} - ${consignment.selectedShippingOption.cost.toFixed(2)}
                                </span>
                            )}
                        </div>

                        {getItemOptions(item.id, "Delivery Date") && (
                            <div className="tt-custom-item-delivery-date">
                                <span className="tt-custom-delivery-date-label">Estimated Delivery Date:</span>
                                <span className="tt-custom-delivery-date-value">{getItemOptions(item.id, "Delivery Date")}</span>
                            </div>
                        )}
                        {/* Display Gift Message in Edit Mode if it exists */}
                        {hasGiftMessage && (
                            <div className="tt-custom-gift-message-container">
                                <h4 className="tt-custom-gift-message-head">
                                    Gift Message
                                </h4>
                                <div className="tt-custom-gift-message">
                                    <div className="tt-custom-gift-message-text">{giftMessage}</div>
                                </div>
                            </div>
                        )}
                        <div className="tt-custom-item-actions">
                            <Button
                                onClick={() => handleEditConsignment(index)}
                                variant={ButtonVariant.Secondary}
                                className="optimizedCheckout-buttonSecondary"
                                disabled={
                                    isEditing &&
                                    currentItemIndex !== index &&
                                    !configuredItems[physicalItems[index].id]
                                }
                            >
                                Edit
                            </Button>
                        </div>
                    </div>
                ) : null}
            </div>
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
                            <>
                                <TranslatedString id="address.consignment_address_updated_text" />{' '}
                                <TranslatedString id="customer.create_address_error" />
                            </>
                        }
                        onClose={handleCloseErrorModal}
                        shouldShowErrorCode={false}
                    />

                    <AddressFormModal
                        countries={countries}
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
