import React, { Component } from 'react';
import { Button, ButtonVariant } from '../ui/button';
import { LoadingOverlay } from '../ui/loading';
import { Alert } from '../ui/alert';
import { TranslatedString } from '@bigcommerce/checkout/locale';
import {
    Cart,
    Country,
    Customer,
    ConsignmentAssignmentRequestBody,
    CheckoutSelectors,
    Address
} from '@bigcommerce/checkout-sdk';

import { AddressFormModal, AddressFormValues, AddressSelect, AddressType, mapAddressFromFormValues, isValidAddress } from "../address";
import { ErrorModal } from '../common/error';
//import getRecommendedShippingOption from './getRecommendedShippingOption';

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
    quantity: number;
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
    checkoutService?: {
        createCustomerAddress: any;
        loadCheckout: any;
    };
    checkoutState?: {
        data: {
            getCheckout: any;
        };
    };
}

interface CustomShippingState {
    isLoading: boolean;
    isEditing: boolean;
    currentItemIndex: number;
    error: string | null;
    selectedAddress: any;
    selectedShippingOption: any;
    itemConsignments: ConsignmentWithItem[];
    isAddAddressModalOpen: boolean;
    configuredItems: { [key: string]: boolean };
    allItemsConfigured: boolean;
    createCustomerAddressError: Error | undefined;
    originalItemOrder: string[];
}

class CustomShipping extends Component<CustomShippingProps, CustomShippingState> {
    constructor(props: CustomShippingProps) {
        super(props);

        this.state = {
            isLoading: false,
            isEditing: false,
            currentItemIndex: 0,
            error: null,
            selectedAddress: null,
            selectedShippingOption: null,
            itemConsignments: [],
            isAddAddressModalOpen: false,
            configuredItems: {},
            allItemsConfigured: false,
            createCustomerAddressError: undefined,
            originalItemOrder: [],
        };
        
    }

    componentDidMount() {
        // Equivalent to the first useEffect that runs on mount
        this.initConsignments();

        // Call onReady to signal the component is ready (replaces another useEffect)
        if (this.props.onReady) {
            this.props.onReady();
        }
    }

    componentDidUpdate(prevProps: CustomShippingProps, prevState: CustomShippingState) {
        const { cart } = this.props;
        const physicalItems = cart.lineItems.physicalItems;

        // Check if currentItemIndex changed (replaces the second useEffect)
        if (prevState.currentItemIndex !== this.state.currentItemIndex && !this.state.isEditing) {
            this.loadCurrentItemShippingOptions();
        }

        // Check if all items are configured (replaces the 4th useEffect)
        if (
            prevState.configuredItems !== this.state.configuredItems ||
            prevProps.cart.lineItems.physicalItems !== physicalItems
        ) {
            if (physicalItems.length === 0) {
                this.setState({ allItemsConfigured: false });
                return;
            }

            const allConfigured = physicalItems.every(item =>
                Boolean(this.state.configuredItems[item.id])
            );

            this.setState({ allItemsConfigured: allConfigured });
        }

        // Check for duplicate addresses (replaces the 3rd useEffect)
        if (
            prevState.itemConsignments !== this.state.itemConsignments ||
            prevState.allItemsConfigured !== this.state.allItemsConfigured
        ) {
            // Check if multiple consignments use the same address
            const addressMap = new Map();
            let hasDuplicateAddresses = false;

            this.state.itemConsignments.forEach(consignment => {
                if (consignment.shippingAddress) {
                    const addressKey = this.getAddressKey(consignment.shippingAddress);
                    if (addressMap.has(addressKey)) {
                        hasDuplicateAddresses = true;
                    } else {
                        addressMap.set(addressKey, true);
                    }
                }
            });

            // If we have duplicate addresses and all items are configured,
            // force a refresh of checkout totals
            if (hasDuplicateAddresses && this.state.allItemsConfigured) {
                this.refreshCheckoutTotals();
            }
        }
    }

    // Helper function to generate a unique key for an address
    getAddressKey = (address: any) => {
        return `${address.firstName}|${address.lastName}|${address.address1}|${address.city}|${address.stateOrProvinceCode}|${address.postalCode}|${address.countryCode}`;
    }

    initConsignments = async () => {
        const { cart, consignments, checkoutState } = this.props;
        const physicalItems = cart.lineItems.physicalItems;

        if (physicalItems.length > 0) {
            this.setState({ isLoading: true });

            try {
                const itemOrder = physicalItems.map(item => item.id.toString());
                this.setState({ originalItemOrder: itemOrder });

                const getCheckout = checkoutState?.data?.getCheckout;
                const checkout = getCheckout?.();

                if (!checkout) {
                    this.setState({ isLoading: false });
                    return;
                }

                const currentConsignments = consignments || [];
                const consignmentsToRemove = currentConsignments.filter(
                    consignment => !consignment.selectedShippingOption
                );

                if (consignmentsToRemove.length > 0) {
                    // Process consignments sequentially to avoid race conditions
                    for (const consignment of consignmentsToRemove) {
                        const options = {
                            method: 'DELETE',
                            headers: {
                                'Accept': 'application/json'
                            }
                        };

                        await fetch(`/api/storefront/checkouts/${checkout.id}/consignments/${consignment.id}`, options);
                    }

                    // After removing consignments, reload checkout
                    await this.props.checkoutService?.loadCheckout();

                    // Get updated consignments (should be fewer now)
                    const remainingConsignments = getCheckout()?.consignments || [];

                    // Initialize empty consignments for all items
                    const initialConsignments = physicalItems.map(item => {
                        // Find if this item has a remaining consignment
                        const existingConsignment = remainingConsignments.find(
                            (c: { lineItemIds: string | string[]; }) => c.lineItemIds.includes(item.id.toString())
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

                    // Update configured items map
                    const configuredItemsMap: { [key: string]: boolean } = {};
                    initialConsignments.forEach(consignment => {
                        configuredItemsMap[consignment.lineItemId] = Boolean(
                            consignment.shippingAddress && consignment.selectedShippingOption
                        );
                    });

                    // Set current item index to the first unconfigured item
                    const firstUnconfiguredIndex = physicalItems.findIndex(
                        item => !configuredItemsMap[item.id]
                    );

                    this.setState({
                        itemConsignments: initialConsignments,
                        configuredItems: configuredItemsMap,
                        currentItemIndex: firstUnconfiguredIndex >= 0 ? firstUnconfiguredIndex : 0
                    });
                } else {
                    // Check if there are any consignments with multiple items that need to be split
                    const consignmentsToSplit = consignments.filter(
                        consignment => consignment.lineItemIds && consignment.lineItemIds.length > 1
                    );

                    // Save the original item order for displaying
                    const itemOrder = physicalItems.map(item => item.id.toString());
                    this.setState({ originalItemOrder: itemOrder });

                    if (consignmentsToSplit.length > 0 && this.props.deleteConsignments) {
                        // Only delete consignments that have multiple items
                        await this.props.deleteConsignments();

                        // Initialize empty consignments for all items after deletion
                        const initialConsignments = physicalItems.map(item => ({
                            lineItemId: item.id as string,
                            shippingAddress: null,
                            selectedShippingOption: null,
                            availableShippingOptions: [],
                        }));

                        this.setState({
                            itemConsignments: initialConsignments,
                            configuredItems: {},
                            currentItemIndex: 0,
                            selectedAddress: null,
                            selectedShippingOption: null
                        });
                    } else {
                        // Map existing consignments to our local state model
                        const mappedConsignments: ConsignmentWithItem[] = [];
                        const configuredItemsMap: { [key: string]: boolean } = {};

                        // Process existing consignments
                        for (const consignment of consignments) {
                            for (const lineItemId of consignment.lineItemIds) {
                                mappedConsignments.push({
                                    id: consignment.id,
                                    lineItemId,
                                    shippingAddress: consignment.shippingAddress,
                                    selectedShippingOption: consignment.selectedShippingOption,
                                    availableShippingOptions: consignment.availableShippingOptions || [],
                                });

                                // Consider item configured ONLY if it has BOTH address AND shipping option
                                configuredItemsMap[lineItemId] = Boolean(
                                    consignment.shippingAddress && consignment.selectedShippingOption
                                );
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

                        // Set current item index to the first unconfigured item
                        const firstUnconfiguredIndex = physicalItems.findIndex(
                            item => !configuredItemsMap[item.id]
                        );

                        const stateUpdate: Partial<CustomShippingState> = {
                            itemConsignments: mappedConsignments,
                            configuredItems: configuredItemsMap,
                            currentItemIndex: firstUnconfiguredIndex >= 0 ? firstUnconfiguredIndex : 0
                        };

                        // If we're starting with a configured item, select its address and shipping option
                        if (firstUnconfiguredIndex >= 0) {
                            const currentItem = physicalItems[firstUnconfiguredIndex];
                            const consignment = mappedConsignments.find(c => c.lineItemId === currentItem.id);

                            // Only pre-select fully configured items (those with both address AND shipping option)
                            if (consignment && consignment.shippingAddress && consignment.selectedShippingOption) {
                                stateUpdate.selectedAddress = consignment.shippingAddress;
                                stateUpdate.selectedShippingOption = consignment.selectedShippingOption;
                            }
                        }

                        this.setState(stateUpdate as CustomShippingState);
                    }

                    // Synchronize with checkout state
                    await this.props.checkoutService?.loadCheckout();
                }
            } catch (err) {
                if (err instanceof Error) {
                    this.setState({ error: `Error initializing: ${err.message}` });
                }
            } finally {
                this.setState({ isLoading: false });
            }
        }
    }

    loadCurrentItemShippingOptions = async () => {
        // Start by clearing selections
        this.setState({
            selectedAddress: null,
            selectedShippingOption: null,
            isLoading: true
        });

        try {
            // Load the latest checkout data
            await this.props.checkoutService?.loadCheckout();

            const currentItem = this.getCurrentItem();
            if (!currentItem) {
                this.setState({ isLoading: false });
                return;
            }

            // Get the updated consignment
            const getCheckout = this.props.checkoutState?.data?.getCheckout;
            const updatedConsignments = getCheckout?.()?.consignments || [];
            const updatedConsignment = updatedConsignments.find((c: { lineItemIds: string | string[]; }) =>
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

                    this.setState({
                        selectedAddress: updatedConsignment.shippingAddress,
                        selectedShippingOption: updatedConsignment.selectedShippingOption
                    });
                }
            }
        } catch (err) {
            console.error('Error loading current item shipping options:', err);
        } finally {
            this.setState({ isLoading: false });
        }
    }

    getCurrentItem = () => {
        const { cart } = this.props;
        const physicalItems = cart.lineItems.physicalItems;
        return physicalItems[this.state.currentItemIndex];
    }

    getCurrentConsignment = () => {
        const currentItem = this.getCurrentItem();
        return currentItem ? this.state.itemConsignments.find(c => c.lineItemId === currentItem.id) : undefined;
    }

    createConsignment = async (address: Address, lineItemId: string | number, quantity: number) => {
        const getCheckout = this.props.checkoutState?.data?.getCheckout;
        const checkout = getCheckout();

        if (!checkout) {
            throw new Error('Checkout not available');
        }

        // First check if this item already has a consignment
        const existingConsignment = this.props.consignments.find(consignment =>
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
    }

    updateConsignmentShippingOption = async (consignmentId: string, shippingOptionId: string) => {
        const getCheckout = this.props.checkoutState?.data?.getCheckout;
        const checkout = getCheckout?.();

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
    }

    handleShippingOptionSelect = async (option: any) => {
        this.setState({
            selectedShippingOption: option,
            isLoading: true
        });

        try {
            // Get current consignment from our local state
            const currentConsignment = this.getCurrentConsignment();

            if (currentConsignment && currentConsignment.id) {
                // Use direct API call to update shipping option
                const result = await this.updateConsignmentShippingOption(currentConsignment.id, option.id);

                // Get updated consignments
                const updatedConsignments = result.consignments || [];

                // Find the updated consignment for our current item
                const updatedConsignment = updatedConsignments.find((c: any) =>
                    c.lineItemIds.some((lineItemId: string) =>
                        lineItemId === this.getCurrentItem()?.id.toString() ||
                        lineItemId === String(this.getCurrentItem()?.id)
                    )
                );

                // Update our local item consignments with the updated data
                if (updatedConsignment) {
                    const newItemConsignments = [...this.state.itemConsignments];
                    const currentIndex = newItemConsignments.findIndex(c => c.lineItemId === this.getCurrentItem()?.id);

                    if (currentIndex >= 0) {
                        newItemConsignments[currentIndex] = {
                            ...newItemConsignments[currentIndex],
                            id: updatedConsignment.id,
                            selectedShippingOption: updatedConsignment.selectedShippingOption,
                        };

                        this.setState({ itemConsignments: newItemConsignments });
                    }
                }

                // Synchronize the checkout state with the changes made via direct API
                await this.refreshCheckoutTotals();
            } else {
                // Fallback update for local state if needed
                const updatedConsignments = [...this.state.itemConsignments];
                const currentIndex = updatedConsignments.findIndex(c => c.lineItemId === this.getCurrentItem()?.id);

                if (currentIndex >= 0) {
                    updatedConsignments[currentIndex] = {
                        ...updatedConsignments[currentIndex],
                        selectedShippingOption: option,
                    };

                    this.setState({ itemConsignments: updatedConsignments });
                }
            }
            await this.updateOrderSummaryDisplay();
        } catch (err) {
            if (err instanceof Error) {
                this.setState({
                    error: err.message,
                    isEditing: false
                });
                this.props.onUnhandledError(err);
            }
        } finally {
            this.setState({ isLoading: false });
        }
    }

    handleAddressSelect = async (address: Address) => {
        // Validate address before proceeding
        if (this.props.getFields && !isValidAddress(address, this.props.getFields(address.countryCode))) {
            this.setState({
                error: 'Please provide a valid address with all required fields',
                isEditing: false
            });
            this.props.onUnhandledError(new InvalidAddressError());
            return;
        }

        this.setState({
            selectedAddress: address,
            isLoading: true
        });

        try {
            // Instead of using the SDK's assignItem, use direct API call to create a separate consignment
            const currentItem = this.getCurrentItem();

            if (currentItem) {
                // Create a single consignment for this item via direct API call
                const result = await this.createConsignment(address, currentItem.id, currentItem.quantity);

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
                    const updatedItemConsignments = [...this.state.itemConsignments];
                    const currentIndex = updatedItemConsignments.findIndex(c => c.lineItemId === currentItem.id);

                    if (currentIndex >= 0) {
                        updatedItemConsignments[currentIndex] = {
                            ...updatedItemConsignments[currentIndex],
                            id: newConsignment.id,
                            shippingAddress: address,
                            availableShippingOptions: newConsignment.availableShippingOptions || [],
                        };

                        this.setState({ itemConsignments: updatedItemConsignments });

                        // IMPORTANT: Do NOT auto-select a shipping option here!
                        // Just load the checkout to ensure UI is in sync
                        await this.props.checkoutService?.loadCheckout();
                    }
                }
            }
        } catch (err) {
            if (err instanceof Error) {
                this.setState({
                    error: err.message,
                    isEditing: false
                });
                this.props.onUnhandledError(err);
            }
        } finally {
            this.setState({ isLoading: false });
        }
    }

    refreshCheckoutTotals = async () => {
        this.setState({ isLoading: true });

        try {
            const getCheckout = this.props.checkoutState?.data?.getCheckout;
            const checkout = getCheckout?.();
            if (!checkout) {
                this.setState({ isLoading: false });
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
            await this.props.checkoutService?.loadCheckout();
        } catch (err) {
            console.error('Error refreshing checkout totals:', err);
        } finally {
            this.setState({ isLoading: false });
        }
    }

    handleContinue = async () => {
        if (!this.state.selectedAddress) {
            this.setState({ error: 'Please select a shipping address' });
            return;
        }

        const currentConsignmentObj = this.getCurrentConsignment();
        const hasShippingOptions = currentConsignmentObj &&
            currentConsignmentObj.availableShippingOptions &&
            currentConsignmentObj.availableShippingOptions.length > 0;

        if (hasShippingOptions && !this.state.selectedShippingOption) {
            this.setState({ error: 'Please select a shipping method' });
            return;
        }

        // Make sure changes are synchronized with checkout state
        await this.props.checkoutService?.loadCheckout();
        await this.updateOrderSummaryDisplay();

        // Mark this item as configured
        const currentItem = this.getCurrentItem();
        if (currentItem) {
            const updatedConfiguredItems = {
                ...this.state.configuredItems,
                [currentItem.id]: true
            };

            this.setState({
                configuredItems: updatedConfiguredItems,
                isEditing: false
            });

            // If there are more items, go to the next one
            if (this.state.currentItemIndex < this.props.cart.lineItems.physicalItems.length - 1) {
                // Find the next unconfigured item
                let nextItemIndex = this.state.currentItemIndex + 1;
                await this.refreshCheckoutTotals();

                // Skip already configured items
                while (
                    nextItemIndex < this.props.cart.lineItems.physicalItems.length &&
                    updatedConfiguredItems[this.props.cart.lineItems.physicalItems[nextItemIndex].id]
                ) {
                    nextItemIndex++;
                }

                if (nextItemIndex < this.props.cart.lineItems.physicalItems.length) {
                    this.setState({
                        currentItemIndex: nextItemIndex,
                        selectedAddress: null,
                        selectedShippingOption: null
                    });

                    // Get the next item's consignment
                    const nextItem = this.props.cart.lineItems.physicalItems[nextItemIndex];
                    const nextConsignment = this.state.itemConsignments.find(c => c.lineItemId === nextItem.id);

                    // Only set selections if the consignment has valid shipping options
                    if (nextConsignment &&
                        nextConsignment.shippingAddress &&
                        nextConsignment.selectedShippingOption &&
                        nextConsignment.availableShippingOptions &&
                        nextConsignment.availableShippingOptions.length > 0) {

                        this.setState({
                            selectedAddress: nextConsignment.shippingAddress,
                            selectedShippingOption: nextConsignment.selectedShippingOption
                        });
                    }
                }
            }
        }
    }

    handleUseNewAddress = () => {
        this.setState({ isAddAddressModalOpen: true });
    }

    handleCloseAddAddressForm = () => {
        this.setState({ isAddAddressModalOpen: false });
    }

    handleSaveAddress = async (addressFormValues: AddressFormValues) => {
        try {
            // First convert form values to an address object
            const address = mapAddressFromFormValues(addressFormValues);

            // Make sure the address is valid before proceeding
            if (this.props.getFields && !isValidAddress(address, this.props.getFields(address.countryCode))) {
                this.setState({ error: 'Please provide a valid address with all required fields' });
                this.props.onUnhandledError(new InvalidAddressError());
                return;
            }

            // Set shouldSaveAddress explicitly to ensure it's saved to the customer's address book
            address.shouldSaveAddress = true;

            // Create the customer address first using the service from checkout
            if (this.props.checkoutService?.createCustomerAddress) {
                try {
                    await this.props.checkoutService.createCustomerAddress(address);
                } catch (error) {
                    if (error instanceof Error) {
                        this.setState({ createCustomerAddressError: error });
                    }
                }
            }

            // Select the address for shipping after creating it
            await this.handleAddressSelect(address);
            this.setState({ isAddAddressModalOpen: false });
        } catch (err) {
            if (err instanceof Error) {
                this.setState({ error: err.message });
                this.props.onUnhandledError(err);
            }
        } finally {
            this.setState({ isLoading: false });
        }
    }

    handleCloseErrorModal = () => {
        this.setState({ createCustomerAddressError: undefined });
    }

    updateOrderSummaryDisplay = async () => {
        const getCheckout = this.props.checkoutState?.data?.getCheckout;
        const checkout = getCheckout?.();

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
            await this.props.checkoutService?.loadCheckout();
        } catch (err) {
            console.error('Error updating order summary display:', err);
        }
    }

    handleEditConsignment = async (index: number) => {
        if (this.state.isEditing) {
            return;
        }

        this.setState({ isEditing: true, currentItemIndex: index });

        // Get the current item ID
        const itemId = this.props.cart.lineItems.physicalItems[index]?.id;

        // Load the selected values for this consignment
        const consignment = this.state.itemConsignments.find(c => c.lineItemId === itemId);

        if (consignment) {
            // Initially set both to null - we'll only set them if valid
            this.setState({
                selectedAddress: null,
                selectedShippingOption: null,
                isLoading: true
            });

            try {
                // Sync with checkout to make sure we have the latest data
                await this.props.checkoutService?.loadCheckout();

                // Get the updated consignment from the checkout state
                const getCheckout = this.props.checkoutState?.data?.getCheckout;
                const updatedConsignments = getCheckout?.()?.consignments || [];
                const updatedConsignment = updatedConsignments.find((c: { lineItemIds: string | string[]; }) =>
                    c.lineItemIds.includes(itemId.toString())
                );

                if (updatedConsignment) {
                    // Update our local item consignment with updated shipping options
                    const updatedItemConsignments = [...this.state.itemConsignments];
                    const consignmentIndex = updatedItemConsignments.findIndex(c => c.lineItemId === itemId);

                    if (consignmentIndex >= 0) {
                        updatedItemConsignments[consignmentIndex] = {
                            ...updatedItemConsignments[consignmentIndex],
                            id: updatedConsignment.id,
                            availableShippingOptions: updatedConsignment.availableShippingOptions || [],
                            selectedShippingOption: updatedConsignment.selectedShippingOption
                        };

                        // Only set the address if shipping options are available
                        const hasShippingOptions =
                            updatedConsignment.availableShippingOptions &&
                            updatedConsignment.availableShippingOptions.length > 0;

                        const stateUpdate: Partial<CustomShippingState> = {
                            itemConsignments: updatedItemConsignments
                        };

                        if (hasShippingOptions) {
                            stateUpdate.selectedAddress = updatedConsignment.shippingAddress;
                            stateUpdate.selectedShippingOption = updatedConsignment.selectedShippingOption;
                        }

                        this.setState(stateUpdate as CustomShippingState);
                    }
                }
            } catch (err) {
                if (err instanceof Error) {
                    this.setState({ error: `Error loading shipping options: ${err.message}` });
                }
            } finally {
                this.setState({ isLoading: false });
            }

            // Important: Mark this item as NOT configured so it shows in edit mode
            this.setState(prevState => {
                const updatedConfiguredItems = { ...prevState.configuredItems };
                delete updatedConfiguredItems[itemId];
                return { configuredItems: updatedConfiguredItems };
            });

            await this.refreshCheckoutTotals();
        }
    }

    handleFinalContinue = async () => {
        if (this.state.isLoading) return;

        this.setState({ isLoading: true });

        try {
            // Make sure all changes are synchronized with BigCommerce checkout state
            await this.refreshCheckoutTotals();
            await this.updateOrderSummaryDisplay();

            // Call navigateNextStep with the current billing/shipping relationship
            this.props.navigateNextStep(this.props.isBillingSameAsShipping);
        } catch (err) {
            if (err instanceof Error) {
                this.setState({
                    error: err.message,
                    isEditing: false
                });
                this.props.onUnhandledError(err);
            }
        } finally {
            this.setState({ isLoading: false });
        }
    }

    getOrderedPhysicalItems = () => {
        // Make a copy of the physical items
        const itemsToOrder = [...this.props.cart.lineItems.physicalItems];

        // Sort the items based on the originalItemOrder array
        return itemsToOrder.sort((a, b) => {
            const aIndex = this.state.originalItemOrder.indexOf(a.id.toString());
            const bIndex = this.state.originalItemOrder.indexOf(b.id.toString());

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
    }

    renderItem = (item: LineItem, index: number) => {
        const isConfigured = this.state.configuredItems[item.id];
        const isBeingEdited = this.state.currentItemIndex === index && !isConfigured;
        const consignment = this.state.itemConsignments.find(c => c.lineItemId === item.id);
        const showSplitButton = isBeingEdited &&
            !isConfigured &&
            item.quantity > 1 &&
            (!consignment || !consignment.id);

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
                                    //onClick={() => this.handleSplitLineItem(item.id, item.quantity)}
                                    variant={ButtonVariant.Secondary}
                                    className="tt-send-multiple-recipients-button"
                                    disabled={this.state.isLoading}
                                >
                                    Send to multiple recipients
                                </Button>
                            )}
                            <h4 className="optimizedCheckout-headingSecondary">
                                Shipping Address
                            </h4>
                            <div className="tt-custom-address-select-container">
                                {this.props.customer.addresses.length > 0 ? (
                                    <AddressSelect
                                        addresses={this.props.customer.addresses}
                                        selectedAddress={this.state.selectedAddress}
                                        type={AddressType.Shipping}
                                        onSelectAddress={this.handleAddressSelect}
                                        onUseNewAddress={this.handleUseNewAddress}
                                        placeholderText={<TranslatedString id="shipping.choose_shipping_address" />}
                                        showSingleLineAddress
                                    />
                                ) : (
                                    <Button
                                        onClick={this.handleUseNewAddress}
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
                        {this.state.selectedAddress && (
                            <div className="tt-custom-shipping-options">
                                <h4 className="optimizedCheckout-headingSecondary">
                                    Shipping Method
                                </h4>

                                {(() => {
                                    const currentConsignment = this.getCurrentConsignment();
                                    const availableOptions = currentConsignment?.availableShippingOptions;

                                    if (currentConsignment && availableOptions && availableOptions.length > 0) {
                                        return (
                                            <div className="tt-custom-shipping-options-list">
                                                {availableOptions.map(option => (
                                                    <div
                                                        key={option.id}
                                                        className={`tt-custom-shipping-option ${this.state.selectedShippingOption?.id === option.id ? 'selected' : ''}`}
                                                        onClick={() => this.handleShippingOptionSelect(option)}
                                                    >
                                                        <input
                                                            type="radio"
                                                            name="shippingOption"
                                                            id={`${item.id}-${option.id}`}
                                                            checked={this.state.selectedShippingOption?.id === option.id}
                                                            onChange={() => this.handleShippingOptionSelect(option)}
                                                        />
                                                        <label htmlFor={`${item.id}-${option.id}`}>
                                                            <div className="tt-custom-option-description">{option.description}</div>
                                                            <div className="tt-custom-option-cost">${option.cost.toFixed(2)}</div>
                                                            {option.transitTime && <div className="tt-custom-option-transit">{option.transitTime}</div>}
                                                        </label>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    } else {
                                        return (
                                            <div className="tt-custom-no-shipping-options">
                                                No shipping options available for this address
                                            </div>
                                        );
                                    }
                                })()}
                            </div>
                        )}

                        {/* Error Alert */}
                        {this.state.error && (
                            <Alert>
                                {this.state.error}
                            </Alert>
                        )}

                        {/* Continue Button */}
                        <div className="form-actions">
                            <Button
                                id={`checkout-shipping-continue-${item.id}`}
                                onClick={this.handleContinue}
                                disabled={
                                    this.state.isLoading ||
                                    !this.state.selectedAddress ||
                                    (() => {
                                        const currentConsignment = this.getCurrentConsignment();
                                        return currentConsignment &&
                                            currentConsignment.availableShippingOptions &&
                                            currentConsignment.availableShippingOptions.length > 0 &&
                                            !this.state.selectedShippingOption;
                                    })()
                                }
                                variant={ButtonVariant.Primary}
                                testId="checkout-shipping-continue"
                                className="optimizedCheckout-buttonPrimary"
                            >
                                {this.state.currentItemIndex < this.props.cart.lineItems.physicalItems.length - 1 ? (
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
                        <div className="tt-custom-item-actions">
                            <Button
                                onClick={() => this.handleEditConsignment(index)}
                                variant={ButtonVariant.Secondary}
                                className="optimizedCheckout-buttonSecondary"
                                disabled={this.state.isEditing}
                            >
                                Edit
                            </Button>
                        </div>
                    </div>
                ) : null}
            </div>
        );
    }

    render() {
        const { cart, countries, customer, countriesWithAutocomplete = ['US', 'CA', 'AU', 'NZ', 'GB'], googleMapsApiKey = '', isFloatingLabelEnabled, getFields } = this.props;
        const { isLoading, createCustomerAddressError, isAddAddressModalOpen, allItemsConfigured } = this.state;

        const physicalItems = cart.lineItems.physicalItems;

        if (!physicalItems.length) {
            return <div>No physical items in cart</div>;
        }

        const currentItem = this.getCurrentItem();

        if (!currentItem) {
            return <div>Loading...</div>;
        }

        return (
            <div className="checkout-form">
                <LoadingOverlay isLoading={isLoading}>
                    <div className="tt-custom-shipping-container">
                        {/* Error and Address Form Modals */}
                        <ErrorModal
                            error={createCustomerAddressError}
                            message={
                                <>
                                    <TranslatedString id="address.consignment_address_updated_text" />{' '}
                                    <TranslatedString id="customer.create_address_error" />
                                </>
                            }
                            onClose={this.handleCloseErrorModal}
                            shouldShowErrorCode={false}
                        />

                        <AddressFormModal
                            countries={countries}
                            countriesWithAutocomplete={countriesWithAutocomplete || ['US', 'CA', 'AU', 'NZ', 'GB']}
                            defaultCountryCode={this.state.selectedAddress?.countryCode || customer?.addresses?.[0]?.countryCode}
                            getFields={getFields || (() => [])}
                            googleMapsApiKey={googleMapsApiKey || ''}
                            isFloatingLabelEnabled={isFloatingLabelEnabled}
                            isLoading={isLoading}
                            isOpen={isAddAddressModalOpen}
                            onRequestClose={this.handleCloseAddAddressForm}
                            onSaveAddress={this.handleSaveAddress}
                            shouldShowSaveAddress={true}
                        />

                        {/* Render all items in original order */}
                        <div className="tt-custom-items-container">
                            {this.getOrderedPhysicalItems().map((item, index) => this.renderItem(item, index))}
                        </div>

                        {/* Final Continue Button */}
                        {allItemsConfigured && (
                            <div className="form-actions">
                                <Button
                                    id="checkout-shipping-final-continue"
                                    onClick={this.handleFinalContinue}
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
    }
}

export default CustomShipping;
