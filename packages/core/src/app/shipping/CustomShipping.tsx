import React, { FunctionComponent, useState, useEffect } from 'react';
import { Button, ButtonVariant } from '../ui/button';
import { LoadingOverlay } from '../ui/loading';
import { Alert } from '../ui/alert';
import { TranslatedString } from '@bigcommerce/checkout/locale';
import { useCheckout } from "@bigcommerce/checkout/payment-integration-api";
import DatePicker from 'react-datepicker';
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
    deleteConsignments,
    countriesWithAutocomplete = ['US', 'CA', 'AU', 'NZ', 'GB'],
    googleMapsApiKey = '',
    isFloatingLabelEnabled,
}) => {
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

    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingDates, setIsLoadingDates] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [currentItemIndex, setCurrentItemIndex] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [selectedAddress, setSelectedAddress] = useState<any>(null);
    const [selectedShippingOption, setSelectedShippingOption] = useState<any>(null);
    const [itemConsignments, setItemConsignments] = useState<ConsignmentWithItem[]>([]);
    const [isAddAddressModalOpen, setIsAddAddressModalOpen] = useState(false);
    const [configuredItems, setConfiguredItems] = useState<{ [key: string]: boolean }>({});
    const [allItemsConfigured, setAllItemsConfigured] = useState(false);
    const [createCustomerAddressError, setCreateCustomerAddressError] = useState<Error | undefined>();
    // Add originalItemOrder state to maintain the display order
    const [originalItemOrder, setOriginalItemOrder] = useState<string[]>([]);

    const [isEditGiftMessageModalOpen, setIsEditGiftMessageModalOpen] = useState(false);
    const [currentGiftMessageItemId, setCurrentGiftMessageItemId] = useState<string | number | null>(null);
    const [editedGiftMessage, setEditedGiftMessage] = useState('');

    const [availableShippingDates, setAvailableShippingDates] = useState<Date[]>([]);
    const [selectedShippingDate, setSelectedShippingDate] = useState<Date | null>(null);
    const [cartItems, setCartItems] = useState<any[]>([]);

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
                setCartItems(cartData[0].lineItems.physicalItems || []);
            }
        } catch (err) {
            console.error('Error fetching cart data:', err);
        }
    };

    const hasValidDeliveryDate = (itemId: string | number) => {
        const cartItem = cartItems.find(item => item.id === itemId);

        if (!cartItem || !cartItem.options || !Array.isArray(cartItem.options)) {
            return false;
        }

        const deliveryDateOption = cartItem.options.find((option: any) =>
            option.name === "Delivery Date" || option.name.includes("Delivery Date")
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
    useEffect(() => {
        const initConsignments = async () => {
            if (physicalItems.length > 0) {
                setIsLoading(true);
                try {
                    await fetchCartData();

                    const itemOrder = physicalItems.map(item => item.id.toString());
                    setOriginalItemOrder(itemOrder);


                    const checkout = getCheckout();
                    if (!checkout) {
                        return;
                    }
                    let currentConsignments = consignments || [];

                    for (const item of physicalItems) {
                        const physicalItem = physicalItems.find(
                            physItem => physItem.id.toString() === item.id.toString()
                        );

                        // Get the quantity dynamically
                        const itemQuantity = physicalItem ? physicalItem.quantity : 1;
                        // Check if this item already has a consignment
                        const existingConsignment = currentConsignments.find(c =>
                            c.lineItemIds.length === 1 &&
                            c.lineItemIds[0] === item.id.toString() &&
                            c.lineItemIds.length === 1
                        );


                        // 1. Consignment exists but has no shipping option or address
                        if (existingConsignment && !existingConsignment.selectedShippingOption) {
                            const storedConsignment = findStoredConsignmentByLineItemId(
                                item.id,
                                itemQuantity
                            );

                            // If stored consignment exists, restore it
                            if (storedConsignment?.selectedShippingOptionId) {
                                try {
                                    await restoreConsignment(storedConsignment);
                                } catch (restoreError) {
                                    console.error(`Error restoring consignment for item ${item.id}:`, restoreError);
                                }
                            }
                        }
                    }
                    const checkoutOptions = {
                        method: 'GET',
                        headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
                    };

                    const response = await fetch(
                        `/api/storefront/checkouts/${checkout.id}?include=consignments.availableShippingOptions`,
                        checkoutOptions
                    );

                    if (!response.ok) {
                        throw new Error('Failed to split line item');
                    }

                    const result = await response.json();
                    currentConsignments = result.consignments || [];

                    const consignmentsToRemove = currentConsignments.filter(
                        consignment => !consignment.selectedShippingOption
                    );
                    if (consignmentsToRemove.length > 0) {
                        // Process consignments sequentially to avoid race conditions
                        for (const consignment of consignmentsToRemove) {
                            // Make sure lineItemIds is always treated as an array
                            const lineItemIds = Array.isArray(consignment.lineItemIds)
                                ? consignment.lineItemIds
                                : [consignment.lineItemIds];
                            for (const lineItemId of lineItemIds) {
                                await clearDeliveryDateForItem(checkout.id, lineItemId);
                            }

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
                        }

                        // After removing consignments, reload checkout
                        await loadCheckout();

                        // Get updated consignments (should be fewer now)
                        const remainingConsignments = getCheckout()?.consignments || [];

                        // Initialize empty consignments for all items
                        const initialConsignments = physicalItems.map(item => {
                            // Find if this item has a remaining consignment
                            const existingConsignment = remainingConsignments.find(
                                c => c.lineItemIds.includes(item.id.toString())
                            );

                            // If it has a valid consignment with shipping option, use it
                            if (existingConsignment && existingConsignment.selectedShippingOption) {
                                return {
                                    id: existingConsignment.id,
                                    lineItemId: item.id as string,
                                    shippingAddress: existingConsignment.shippingAddress,
                                    selectedShippingOption: existingConsignment.selectedShippingOption,
                                    availableShippingOptions: existingConsignment.availableShippingOptions || [],
                                };
                            }

                            // Otherwise create a fresh entry
                            return {
                                lineItemId: item.id as string,
                                shippingAddress: null,
                                selectedShippingOption: null,
                                availableShippingOptions: [],
                            };
                        });

                        setItemConsignments(initialConsignments);

                        const configuredItemsMap: { [key: string]: boolean } = {};
                        initialConsignments.forEach(consignment => {
                            // First check if consignment has address and shipping option
                            const hasAddressAndShipping = Boolean(
                                consignment.shippingAddress && consignment.selectedShippingOption
                            );

                            // Then check if it has a valid delivery date
                            const hasValidDeliveryDateValue = hasValidDeliveryDate(consignment.lineItemId);

                            // Only consider an item configured if it has all three requirements
                            configuredItemsMap[consignment.lineItemId] = hasAddressAndShipping && hasValidDeliveryDateValue;
                        });

                        setConfiguredItems(configuredItemsMap);
                        // Set current item index to the first unconfigured item
                        const firstUnconfiguredIndex = physicalItems.findIndex(
                            item => !configuredItemsMap[item.id]
                        );
                        setCurrentItemIndex(firstUnconfiguredIndex >= 0 ? firstUnconfiguredIndex : 0);
                    } else {


                        // Check if there are any consignments with multiple items that need to be split
                        const consignmentsToSplit = currentConsignments.filter(
                            consignment => consignment.lineItemIds && consignment.lineItemIds.length > 1
                        );

                        // Save the original item order for displaying
                        const itemOrder = physicalItems.map(item => item.id.toString());
                        setOriginalItemOrder(itemOrder);

                        if (consignmentsToSplit.length > 0 && deleteConsignments) {
                            // Only delete consignments that have multiple items
                            await deleteConsignments();

                            // Initialize empty consignments for all items after deletion
                            const initialConsignments = physicalItems.map(item => ({
                                lineItemId: item.id as string,
                                shippingAddress: null,
                                selectedShippingOption: null,
                                availableShippingOptions: [],
                            }));

                            setItemConsignments(initialConsignments);
                            setConfiguredItems({});
                            setCurrentItemIndex(0);
                            setSelectedAddress(null);
                            setSelectedShippingOption(null);
                        } else {
                            // Map existing consignments to our local state model
                            const mappedConsignments: ConsignmentWithItem[] = [];
                            const configuredItemsMap: { [key: string]: boolean } = {};

                            // Process existing consignments
                            for (const consignment of currentConsignments) {
                                for (const lineItemId of consignment.lineItemIds) {
                                    mappedConsignments.push({
                                        id: consignment.id,
                                        lineItemId,
                                        shippingAddress: consignment.shippingAddress,
                                        selectedShippingOption: consignment.selectedShippingOption,
                                        availableShippingOptions: consignment.availableShippingOptions || [],
                                    });

                                    // Consider item configured ONLY if it has BOTH address AND shipping option and delivery date
                                    const hasAddressAndShipping = Boolean(
                                        consignment.shippingAddress && consignment.selectedShippingOption
                                    );
                                    // const hasValidDeliveryDateValue = hasValidDeliveryDate(lineItemId);
                                    // console.log('hasValidDeliveryDateValue', hasValidDeliveryDateValue)
                                    // console.log('hasAddressAndShipping', hasAddressAndShipping)
                                    // console.log('lineItemId', lineItemId)
                                    configuredItemsMap[lineItemId] = hasAddressAndShipping;
                                }
                            }

                            // Handle unconfigured items by adding them to our model
                            const configuredLineItemIds = Object.keys(configuredItemsMap);
                            physicalItems.forEach(item => {
                                if (!configuredLineItemIds.includes(item.id.toString())) {
                                    mappedConsignments.push({
                                        lineItemId: item.id as string,
                                        shippingAddress: null,
                                        selectedShippingOption: null,
                                        availableShippingOptions: [],
                                    });
                                    configuredItemsMap[item.id] = false;
                                }
                            });

                            setItemConsignments(mappedConsignments);
                            setConfiguredItems(configuredItemsMap);

                            // Set current item index to the first unconfigured item
                            const firstUnconfiguredIndex = physicalItems.findIndex(
                                item => !configuredItemsMap[item.id]
                            );
                            setCurrentItemIndex(firstUnconfiguredIndex >= 0 ? firstUnconfiguredIndex : 0);

                            // If we're starting with a configured item, select its address and shipping option
                            if (firstUnconfiguredIndex >= 0) {
                                const currentItem = physicalItems[firstUnconfiguredIndex];
                                const consignment = mappedConsignments.find(c => c.lineItemId === currentItem.id);

                                // Only pre-select fully configured items (those with both address AND shipping option)
                                if (consignment && consignment.shippingAddress && consignment.selectedShippingOption) {
                                    setSelectedAddress(consignment.shippingAddress);
                                    setSelectedShippingOption(consignment.selectedShippingOption);
                                } else {
                                    // For unconfigured items or those with missing shipping option, start fresh
                                    setSelectedAddress(null);
                                    setSelectedShippingOption(null);
                                }
                            }
                        }

                        // Synchronize with checkout state
                        await loadCheckout();
                    }



                    // Reload checkout after potential restorations
                    await loadCheckout();

                } catch (err) {
                    if (err instanceof Error) {
                        setError(`Error initializing: ${err.message}`);
                    }
                } finally {
                    setIsLoading(false);
                }
            }
        };

        initConsignments();
    }, []);

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
        if (!isEditing) {
            loadCurrentItemShippingOptions();
        }
    }, [currentItemIndex]);

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
        if (physicalItems.length === 0) {
            setAllItemsConfigured(false);
            return;
        }

        const allConfigured = physicalItems.every(item => {
            // Check if the item has a shipping address and shipping option
            const isBasicConfigured = Boolean(configuredItems[item.id]);

            // Check if the item has a valid delivery date
            const hasDeliveryDate = hasValidDeliveryDate(item.id);

            // Item is fully configured only if both conditions are met
            return isBasicConfigured && hasDeliveryDate;
        });
        setAllItemsConfigured(allConfigured);
    }, [physicalItems, configuredItems, cartItems]);

    const getCurrentItem = () => {
        return physicalItems[currentItemIndex];
    };

    const getCurrentConsignment = () => {
        const currentItem = getCurrentItem();
        return currentItem ? itemConsignments.find(c => c.lineItemId === currentItem.id) : undefined;
    };

    const createConsignment = async (address: Address, lineItemId: string | number, quantity: number) => {
        const checkout = getCheckout();

        if (!checkout) {
            throw new Error('Checkout not available');
        }

        // First check if this item already has a consignment
        const existingConsignment = consignments.find(consignment =>
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



    const handleAddressSelect = async (address: Address) => {
        // Validate address before proceeding
        if (getFields && !isValidAddress(address, getFields(address.countryCode))) {
            setError('Please provide a valid address with all required fields');
            setIsEditing(false);
            onUnhandledError(new InvalidAddressError());
            return;
        }

        setSelectedAddress(address);
        setIsLoading(true);

        setAvailableShippingDates([]);

        // Reset selected date when shipping option changes
        setSelectedShippingDate(null);

        try {
            // Instead of using the SDK's assignItem, use direct API call to create a separate consignment
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

                // Update our item consignments list
                if (newConsignment) {

                    saveConsignmentToSession(
                        newConsignment.id,
                        currentItem.id,
                        currentItem.quantity,
                        address,
                        newConsignment.selectedShippingOption?.id || ''
                    );

                    const updatedItemConsignments = [...itemConsignments];
                    const currentIndex = updatedItemConsignments.findIndex(c => c.lineItemId === currentItem.id);

                    if (currentIndex >= 0) {
                        updatedItemConsignments[currentIndex] = {
                            ...updatedItemConsignments[currentIndex],
                            id: newConsignment.id,
                            shippingAddress: address,
                            availableShippingOptions: newConsignment.availableShippingOptions || [],
                        };

                        setItemConsignments(updatedItemConsignments);

                        // IMPORTANT: Do NOT auto-select a shipping option here!
                        // Just load the checkout to ensure UI is in sync
                        await loadCheckout();
                    }
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


    const handleContinue = async () => {
        if (!selectedAddress) {
            setError('Please select a shipping address');
            return;
        }

        const currentConsignmentObj = getCurrentConsignment();
        const hasShippingOptions = currentConsignmentObj &&
            currentConsignmentObj.availableShippingOptions &&
            currentConsignmentObj.availableShippingOptions.length > 0;

        if (hasShippingOptions && !selectedShippingOption) {
            setError('Please select a shipping method');
            return;
        }

        // New validation for delivery date
        if (hasShippingOptions && !selectedShippingDate) {
            setError('Please select a delivery date');
            return;
        }

        const currentItem = getCurrentItem();
        if (currentItem && !hasValidDeliveryDate(currentItem.id)) {
            setError('Please provide a delivery date');
            return;
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

            // Explicitly check all other items to ensure their state is accurate
            // This prevents the issue where all items become configured incorrectly
            physicalItems.forEach(item => {
                if (item.id !== currentItem.id) {
                    // For other items, verify that they're actually configured
                    const consignment = itemConsignments.find(c => c.lineItemId === item.id);
                    const isFullyConfigured = Boolean(
                        consignment &&
                        consignment.shippingAddress &&
                        consignment.selectedShippingOption
                    );
                    const hasDeliveryDate = hasValidDeliveryDate(item.id);

                    // Only mark as configured if both conditions are met
                    updatedConfiguredItems[item.id] = isFullyConfigured && hasDeliveryDate;
                }
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

            // Set shouldSaveAddress explicitly to ensure it's saved to the customer's address book
            address.shouldSaveAddress = true;

            // Create the customer address first using the service from useCheckout hook
            if (createCustomerAddress) {
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

            // // Update itemConsignments with the restored data
            // const updatedItemConsignments = itemConsignments.map(consignment => {
            //     // Find the corresponding consignment in updatedConsignments
            //     const matchingConsignment = newConsignments.find(
            //         (c: { lineItemIds: (string | number)[]; }) => c.lineItemIds[0] === consignment.lineItemId
            //     );

            //     if (matchingConsignment) {
            //         return {
            //             ...consignment,
            //             id: matchingConsignment.id,
            //             shippingAddress: matchingConsignment.shippingAddress,
            //             selectedShippingOption: matchingConsignment.selectedShippingOption,
            //             availableShippingOptions: matchingConsignment.availableShippingOptions || [],
            //         };
            //     }

            //     return consignment;
            // });

            // // Update state
            // setItemConsignments(updatedItemConsignments);

            // setItemConsignments(prevConsignments => {
            //     // Filter out existing consignments for the split item
            //     const filteredConsignments = prevConsignments.filter(
            //         c => c.lineItemId !== lineItemId
            //     );

            //     // Add new unique consignments
            //     return [
            //         ...filteredConsignments,
            //         ...newItemConsignments
            //     ];
            // });

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
            console.log('currentItem', currentItem)
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
            console.log('updateOptions', updateOptions)
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

                const hasDeliveryDate = hasValidDeliveryDate(consignment.lineItemId);
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

    const handleSubmitGiftMessage = async (message: string) => {
        if (!currentGiftMessageItemId) return;

        try {
            setIsLoading(true);

            // Get the current checkout
            const checkout = getCheckout();
            if (!checkout) {
                throw new Error('Checkout not available');
            }

            const response = await fetch('https://bc-middleware-mm.onrender.com/cart/update-gift-message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    cartId: checkout.id,
                    itemId: currentGiftMessageItemId,
                    message: message
                })
            });

            if (!response.ok) {
                throw new Error('Failed to update gift message');
            }

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
                if (consignment.lineItemId === currentGiftMessageItemId) {
                    return;
                }

                const isFullyConfigured =
                    consignment.shippingAddress &&
                    Object.keys(consignment.shippingAddress).length > 0 &&
                    consignment.selectedShippingOption;

                const hasDeliveryDate = hasValidDeliveryDate(consignment.lineItemId);
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

            // Close modal and reset states
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

                            const fullShippingOption = relevantConsignment.availableShippingOptions.find(
                                (option: { id: any; }) => option.id === relevantConsignment.selectedShippingOption.id
                            );

                            if (fullShippingOption) {
                                setIsLoadingDates(true);
                                try {
                                    const fetchDatesPromise = fetchShippingDates(
                                        relevantConsignment.shippingAddress,
                                        itemId,
                                        fullShippingOption.description
                                    );

                                    const dates = await fetchDatesPromise;

                                    setAvailableShippingDates(dates);

                                    // If there's a delivery date in the cart, try to select it
                                    await fetchCartData();
                                    const deliveryDate = getItemDeliveryDate(itemId);
                                    if (deliveryDate) {
                                        // Try to convert the string date to a Date object
                                        try {
                                            const dateParts = deliveryDate.split('/');
                                            if (dateParts.length === 3) {
                                                const month = parseInt(dateParts[0]) - 1; // JS months are 0-indexed
                                                const day = parseInt(dateParts[1]);
                                                const year = parseInt(dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2]);

                                                const dateObj = new Date(year, month, day);
                                                if (!isNaN(dateObj.getTime())) {
                                                    // First try to find an exact match
                                                    const exactMatch = dates.find(date =>
                                                        date.getFullYear() === dateObj.getFullYear() &&
                                                        date.getMonth() === dateObj.getMonth() &&
                                                        date.getDate() === dateObj.getDate()
                                                    );

                                                    if (exactMatch) {
                                                        setSelectedShippingDate(exactMatch);
                                                    } else {
                                                        // Fall back to closest date if no exact match
                                                        const closestDate = dates.reduce((prev, curr) => {
                                                            return (Math.abs(curr.getTime() - dateObj.getTime()) <
                                                                Math.abs(prev.getTime() - dateObj.getTime()))
                                                                ? curr : prev;
                                                        });
                                                        setSelectedShippingDate(closestDate);
                                                    }
                                                }

                                            }
                                        }
                                        catch (error) {
                                            console.error('Error parsing delivery date:', error);
                                        }
                                    }
                                } catch (error) {
                                    console.error('Error fetching shipping dates:', error);
                                }

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

        const hasGiftMessage = item.giftWrapping && item.giftWrapping.message;
        const showAddGiftMessageButton = !hasGiftMessage && !showSplitButton;

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
                        <span className="tt-custom-item-quantity">Qty: {item.quantity}</span>
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
                                        <div className="tt-custom-gift-message-text">{item?.giftWrapping?.message}</div>
                                        <a
                                            href="#"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                handleEditGiftMessage(item.id, item?.giftWrapping?.message || '');
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
                        {selectedAddress && (
                            <div className="tt-custom-shipping-options">
                                <h4 className="optimizedCheckout-headingSecondary">
                                    Shipping Method
                                </h4>

                                {renderShippingOptions()}
                            </div>
                        )}

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

                        {getItemDeliveryDate(item.id) && (
                            <div className="tt-custom-item-delivery-date">
                                <span className="tt-custom-delivery-date-label">Delivery Date:</span>
                                <span className="tt-custom-delivery-date-value">{getItemDeliveryDate(item.id)}</span>
                            </div>
                        )}
                        {/* Display Gift Message in Edit Mode if it exists */}
                        {hasGiftMessage && (
                            <div className="tt-custom-gift-message-container">
                                <h4 className="tt-custom-gift-message-head">
                                    Gift Message
                                </h4>
                                <div className="tt-custom-gift-message">
                                    <div className="tt-custom-gift-message-text">{item?.giftWrapping?.message}</div>
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
            <LoadingOverlay isLoading={isLoading || isLoadingDates}>
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